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
    `#!/bin/sh
printf '%s\\n' "$@" >> "$DOCKER_LOG"
echo '---' >> "$DOCKER_LOG"
if [ "\${CLEAR_PASSWORD:-}" = 1 ]; then
  case " \$* " in
    *" exec "*)
      if [ -n "\${ENV_FILE:-}" ] && [ -f "$ENV_FILE" ]; then
        tmp="$ENV_FILE.seed-clear"
        sed 's/^[[:space:]]*BOOTSTRAP_OWNER_PASSWORD=.*/BOOTSTRAP_OWNER_PASSWORD=/' "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
      fi
      ;;
  esac
fi
if [ -n "\${SEED_NOTE:-}" ]; then
  printf '%s\\n' "$SEED_NOTE" >&2
fi
exit "\${SEED_EXIT:-0}"
`,
  );
  chmodSync(join(bin, "docker"), 0o755);
  return log;
}

test("the seed passes BOOTSTRAP_* with exec -e and does not put the password on the command line", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const envFile = join(root, ".env");
  const composeA = join(root, "docker-compose.yml");
  const composeB = join(root, "extra-compose.yml");
  fakeDocker(bin, log);
  const original = "BOOTSTRAP_OWNER=\nBOOTSTRAP_OWNER_EMAIL=\nBOOTSTRAP_OWNER_PASSWORD=left-behind\nPOSTGRES_PASSWORD=db\n";
  writeFileSync(envFile, original);
  const result = await execFileAsync(join(projectRoot(), "scripts/seed-owner.sh"), [], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ENV_FILE: envFile,
      COMPOSE_FILE: `${composeA}:${composeB}`,
      COMPOSE_PROFILES: "media, calls",
      DOCKER_LOG: log,
      CLEAR_PASSWORD: "1",
      BOOTSTRAP_OWNER: "Josh",
      BOOTSTRAP_OWNER_EMAIL: "josh@example.com",
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    },
  });
  assert.match(result.stdout, /API was recreated/);
  const trace = readFileSync(log, "utf8");
  assert.match(trace, /exec\n-T\n-e\nBOOTSTRAP_OWNER\n-e\nBOOTSTRAP_OWNER_EMAIL\n-e\nBOOTSTRAP_OWNER_PASSWORD\n/);
  assert.equal(trace.includes(`${PASSWORD}`), false);
  assert.equal(trace.includes("BOOTSTRAP_OWNER_PASSWORD="), false);
  assert.equal(trace.includes("left-behind"), false);
  assert.ok(trace.includes(`-f\n${composeA}\n-f\n${composeB}\n`));
  assert.ok(trace.includes("--profile\nmedia\n--profile\ncalls\n"));
  assert.match(trace, /up\n-d\n--force-recreate\n--no-deps\napi\n/);
  const stored = readFileSync(envFile, "utf8");
  assert.match(stored, /^BOOTSTRAP_OWNER_PASSWORD=$/m);
  assert.equal(stored.includes("left-behind"), false);
  assert.equal(stored.includes(PASSWORD), false);
  assert.match(stored, /^POSTGRES_PASSWORD=db$/m);
});

test("a clean run does not edit .env or recreate the api, and a re-run still does not", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const envFile = join(root, ".env");
  fakeDocker(bin, log);
  const original = "POSTGRES_PASSWORD=db\nBOOTSTRAP_OWNER_PASSWORD=\n";
  writeFileSync(envFile, original);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    ENV_FILE: envFile,
    COMPOSE_FILE: join(root, "missing-compose.yml"),
    DOCKER_LOG: log,
    BOOTSTRAP_OWNER: "Josh",
    BOOTSTRAP_OWNER_EMAIL: "josh@example.com",
    BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
  };
  const first = await execFileAsync(join(projectRoot(), "scripts/seed-owner.sh"), [], { env });
  assert.match(first.stdout, /Josh is seated/);
  assert.equal(first.stdout.includes("recreated"), false);
  assert.equal(readFileSync(envFile, "utf8"), original);
  let trace = readFileSync(log, "utf8");
  assert.match(trace, /exec\n-T\n/);
  assert.equal(trace.includes("force-recreate"), false);
  assert.equal(trace.includes("\nup\n"), false);

  const second = await execFileAsync(join(projectRoot(), "scripts/seed-owner.sh"), [], { env });
  assert.match(second.stdout, /Josh is seated/);
  assert.equal(second.stdout.includes("recreated"), false);
  assert.equal(readFileSync(envFile, "utf8"), original);
  trace = readFileSync(log, "utf8");
  assert.equal(trace.includes("force-recreate"), false);
  assert.equal(trace.includes("\nup\n"), false);
  assert.equal(trace.split("---").filter((part) => part.includes("exec")).length, 2);
});

test("a clean re-run that finds Josh already seated exits 0 and does not recreate the api", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const envFile = join(root, ".env");
  fakeDocker(bin, log);
  const original = "POSTGRES_PASSWORD=db\n";
  writeFileSync(envFile, original);
  const result = await execFileAsync(join(projectRoot(), "scripts/seed-owner.sh"), [], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ENV_FILE: envFile,
      COMPOSE_FILE: join(root, "missing-compose.yml"),
      DOCKER_LOG: log,
      SEED_EXIT: "1",
      SEED_NOTE: "The founding admin is already seated. This runs once.",
      BOOTSTRAP_OWNER: "Josh",
      BOOTSTRAP_OWNER_EMAIL: "josh@example.com",
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    },
  });
  assert.equal(result.code ?? 0, 0);
  assert.match(result.stdout, /Josh is already seated/);
  assert.equal(readFileSync(envFile, "utf8"), original);
  const trace = readFileSync(log, "utf8");
  assert.match(trace, /exec\n-T\n/);
  assert.equal(trace.includes("force-recreate"), false);
  assert.equal(trace.includes("\nup\n"), false);
});

test("a leftover password that is still set does not recreate the api", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const envFile = join(root, ".env");
  fakeDocker(bin, log);
  const original = "BOOTSTRAP_OWNER_PASSWORD=left-behind\nPOSTGRES_PASSWORD=db\n";
  writeFileSync(envFile, original);
  const failed = await execFileAsync(join(projectRoot(), "scripts/seed-owner.sh"), [], {
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
  }).then(
    () => {
      throw new Error("a failed clear should exit non-zero");
    },
    (error) => error,
  );
  assert.notEqual(failed.code, 0);
  assert.match(String(failed.stderr ?? ""), /not recreated/);
  assert.equal(readFileSync(envFile, "utf8"), original);
  const trace = readFileSync(log, "utf8");
  assert.match(trace, /exec\n-T\n/);
  assert.equal(trace.includes("force-recreate"), false);
  assert.equal(trace.includes("\nup\n"), false);
});

test("pipefail is turned on only when the shell supports it", async () => {
  const script = readFileSync(join(projectRoot(), "scripts/seed-owner.sh"), "utf8");
  assert.match(script, /if \(set -o pipefail\) 2>\/dev\/null; then/);
  const probe = [
    "set -eu",
    "if (set -o pipefail) 2>/dev/null; then",
    "  set -o pipefail",
    "  echo on",
    "else",
    "  echo off",
    "fi",
  ].join("\n");
  const dash = await execFileAsync("dash", ["-c", probe]);
  assert.equal(dash.stdout.trim(), "off");
  const bash = await execFileAsync("bash", ["-c", probe]);
  assert.equal(bash.stdout.trim(), "on");
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

test("Ctrl-C during the hidden password prompt restores terminal echo", async () => {
  const root = mkdtempSync(join(tmpdir(), "avouch-seed-"));
  const bin = join(root, "bin");
  const log = join(root, "docker.log");
  const envFile = join(root, ".env");
  const transcript = join(root, "tty.txt");
  fakeDocker(bin, log);
  writeFileSync(log, "");
  writeFileSync(envFile, "POSTGRES_PASSWORD=db\n");
  const py = `
import os, pty, select, signal, sys, termios
script, log, envfile, bin_dir, transcript = sys.argv[1:6]
env = os.environ.copy()
for key in ("BOOTSTRAP_OWNER", "BOOTSTRAP_OWNER_EMAIL", "BOOTSTRAP_OWNER_PASSWORD"):
    env.pop(key, None)
env["ENV_FILE"] = envfile
env["DOCKER_LOG"] = log
env["COMPOSE_FILE"] = os.path.join(os.path.dirname(envfile), "missing-compose.yml")
env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
pid, fd = pty.fork()
if pid == 0:
    os.execvpe(script, [script], env)
buf = b""
sent = 0
answers = [b"Josh\\n", b"josh@example.com\\n"]
interrupted = False
while not interrupted:
    ready, _, _ = select.select([fd], [], [], 5)
    if not ready:
        os.kill(pid, signal.SIGKILL)
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
    elif sent == len(answers) and buf.endswith(b": "):
        attrs = termios.tcgetattr(fd)
        if attrs[3] & termios.ECHO:
            os.kill(pid, signal.SIGKILL)
            sys.stderr.write("echo still on at the password prompt\\n")
            sys.exit(1)
        os.killpg(os.getpgid(pid), signal.SIGINT)
        interrupted = True
while True:
    ready, _, _ = select.select([fd], [], [], 2)
    if not ready:
        break
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    buf += chunk
_, status = os.waitpid(pid, 0)
open(transcript, "wb").write(buf)
if not interrupted:
    sys.stderr.write("never reached the password prompt\\n")
    sys.exit(1)
attrs = termios.tcgetattr(fd)
if not (attrs[3] & termios.ECHO):
    sys.stderr.write("echo left off after interrupt\\n")
    sys.exit(1)
if not (os.WIFEXITED(status) and os.WEXITSTATUS(status) == 130):
    sys.stderr.write("expected exit 130, status %s\\n" % (status,))
    sys.exit(1)
`;
  await execFileAsync("python3", ["-c", py, join(projectRoot(), "scripts/seed-owner.sh"), log, envFile, bin, transcript]);
  assert.equal(readFileSync(log, "utf8"), "");
  assert.match(readFileSync(transcript, "utf8"), /BOOTSTRAP_OWNER_PASSWORD: /);
});
