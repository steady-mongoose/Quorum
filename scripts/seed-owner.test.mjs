import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { projectRoot } from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);
const PASSWORD = "super-secret-seat";

function fakeDocker(bin, log) {
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "docker"),
    "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$DOCKER_LOG\"\necho '---' >> \"$DOCKER_LOG\"\n",
  );
  chmodSync(join(bin, "docker"), 0o755);
  return log;
}

test("the seed passes BOOTSTRAP_* with exec -e and does not put the password on the command line", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const envFile = join(root, ".env");
  fakeDocker(bin, log);
  writeFileSync(envFile, "BOOTSTRAP_OWNER=\nBOOTSTRAP_OWNER_EMAIL=\nBOOTSTRAP_OWNER_PASSWORD=left-behind\nPOSTGRES_PASSWORD=db\n");
  const result = await execFileAsync(join(projectRoot(), "scripts/seed-owner.sh"), [], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ENV_FILE: envFile,
      COMPOSE_FILE: join(root, "missing-compose.yml"),
      DOCKER_LOG: log,
      BOOTSTRAP_OWNER: "Josh",
      BOOTSTRAP_OWNER_EMAIL: "josh@example.com",
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    },
  });
  assert.match(result.stdout, /Josh is seated/);
  const trace = readFileSync(log, "utf8");
  assert.match(trace, /exec\n-T\n-e\nBOOTSTRAP_OWNER\n-e\nBOOTSTRAP_OWNER_EMAIL\n-e\nBOOTSTRAP_OWNER_PASSWORD\n/);
  assert.equal(trace.includes(`${PASSWORD}`), false);
  assert.equal(trace.includes("BOOTSTRAP_OWNER_PASSWORD="), false);
  assert.equal(trace.includes("left-behind"), false);
  const stored = readFileSync(envFile, "utf8");
  assert.match(stored, /^BOOTSTRAP_OWNER_PASSWORD=$/m);
  assert.equal(stored.includes(PASSWORD), false);
  assert.equal(stored.includes("left-behind"), false);
  assert.match(stored, /^POSTGRES_PASSWORD=db$/m);
});

test("without a terminal the seed refuses to run when BOOTSTRAP_* is unset", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  fakeDocker(bin, log);
  writeFileSync(log, "");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_LOG: log };
  delete env.BOOTSTRAP_OWNER;
  delete env.BOOTSTRAP_OWNER_EMAIL;
  delete env.BOOTSTRAP_OWNER_PASSWORD;
  const failed = await execFileAsync(join(projectRoot(), "scripts/seed-owner.sh"), [], { env }).then(
    () => {
      throw new Error("seed should have refused");
    },
    (error) => error,
  );
  assert.match(String(failed.stderr ?? ""), /BOOTSTRAP_OWNER/);
  assert.equal(readFileSync(log, "utf8"), "");
});

test("a terminal prompt does not echo the password and still uses exec -e", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const envFile = join(root, ".env");
  const transcript = join(root, "tty.txt");
  fakeDocker(bin, log);
  writeFileSync(envFile, "POSTGRES_PASSWORD=db\n");
  const py = `
import os, pty, select, sys
script, log, envfile, bin_dir, transcript = sys.argv[1:6]
env = os.environ.copy()
for key in ("BOOTSTRAP_OWNER", "BOOTSTRAP_OWNER_EMAIL", "BOOTSTRAP_OWNER_PASSWORD"):
    env.pop(key, None)
env["ENV_FILE"] = envfile
env["DOCKER_LOG"] = log
env["COMPOSE_FILE"] = os.path.join(os.path.dirname(envfile), "missing-compose.yml")
env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
password = b"s3cret horse"
answers = [b"Josh\\n", b"josh@example.com\\n", password + b"\\n"]
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(script, [script], env)
buf = b""
sent = 0
while True:
    ready, _, _ = select.select([fd], [], [], 5)
    if not ready:
        sys.stderr.write("prompt timed out\\n")
        sys.exit(1)
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    buf += chunk
    if sent < len(answers) and buf.endswith(b": "):
        os.write(fd, answers[sent])
        sent += 1
_, status = os.waitpid(pid, 0)
open(transcript, "wb").write(buf)
sys.exit(0 if os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0 else 1)
`;
  await execFileAsync("python3", ["-c", py, join(projectRoot(), "scripts/seed-owner.sh"), log, envFile, bin, transcript]);
  const seen = readFileSync(transcript);
  assert.equal(seen.includes("s3cret horse"), false);
  const trace = readFileSync(log, "utf8");
  assert.match(trace, /-e\nBOOTSTRAP_OWNER_PASSWORD\n/);
  assert.equal(trace.includes("s3cret horse"), false);
  assert.equal(readFileSync(envFile, "utf8").includes("s3cret horse"), false);
});
