#!/usr/bin/env node
/**
 * `npm run dev:local` — start the dev server on the first free port.
 *
 * `npm run dev` is pinned to 8080 (the live-preview contract) and refuses to
 * start when something else holds it. On a personal machine that port is often
 * taken, so this tries 8080 first and walks upward until a port is free, then
 * runs the same dev command on it. Set PORT to start the search elsewhere.
 *
 * A port counts as free only if nothing is listening on it on any local
 * address. Checking the wildcard alone is not enough: on macOS a server bound
 * to 127.0.0.1 does not block a bind to 0.0.0.0, and the browser then reaches
 * the other program at `localhost` instead of this app.
 *
 * When the first port is taken, the program holding it is named (with its
 * process id and the command that stops it) so the conflict can be cleared.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exitStatusFromChild, isMainModule } from "./with-app-env.mjs";

export const DEFAULT_PORT = 8080;
export const MAX_TRIES = 50;
const HOSTS = ["0.0.0.0", "127.0.0.1", "::1"];

/** The port to try first: a valid PORT from the environment, else 8080. */
export function startPort(env) {
  const raw = env.PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535; got "${raw}"`);
  }
  return port;
}

/** Whether `port` can be bound on `host`. A host this machine lacks counts as free. */
function canBind(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err) => {
      resolve(err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT");
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** Whether nothing is listening on `port` on any local address. */
export async function isPortFree(port) {
  for (const host of HOSTS) {
    if (!(await canBind(port, host))) return false;
  }
  return true;
}

/** First free port at or above `first`, or null after `tries` attempts. */
export async function findFreePort(first, tries = MAX_TRIES, isFree = isPortFree) {
  for (let port = first; port < first + tries && port <= 65535; port++) {
    if (await isFree(port)) return port;
  }
  return null;
}

/** `{ pid, name }` pairs from `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpc` output. */
export function parseLsofHolders(output) {
  const holders = [];
  let pid = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("c") && pid) holders.push({ pid, name: line.slice(1) });
  }
  return dedupeHolders(holders);
}

/** Process ids listening on `port`, from Windows `netstat -ano -p tcp` output. */
export function parseNetstatPids(output, port) {
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0] !== "TCP" || cols[3] !== "LISTENING") continue;
    if (!cols[1].endsWith(`:${port}`)) continue;
    const pid = Number(cols[4]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Image name from one `tasklist /FO CSV /NH` row, or null. */
export function parseTasklistName(output) {
  const match = /^"([^"]+)"/.exec(output.trim());
  return match ? match[1] : null;
}

function dedupeHolders(holders) {
  const seen = new Set();
  return holders.filter(({ pid }) => !seen.has(pid) && seen.add(pid));
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Best-effort list of the programs listening on `port`; empty when unknown. */
export function portHolders(port, platform = process.platform) {
  try {
    if (platform === "win32") {
      return parseNetstatPids(run("netstat", ["-ano", "-p", "tcp"]), port).map((pid) => {
        let name = null;
        try {
          name = parseTasklistName(run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]));
        } catch {
          // The name is a convenience; the pid alone is enough to act on.
        }
        return { pid, name: name ?? "unknown program" };
      });
    }
    return parseLsofHolders(run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]));
  } catch {
    return [];
  }
}

/** The lines printed when `port` is taken: who holds it and how to free it. */
export function conflictHelp(port, holders, platform = process.platform) {
  const lines = [];
  if (holders.length === 0) {
    lines.push(`[dev-local] port ${port} is in use (could not identify the program)`);
    lines.push(
      platform === "win32"
        ? `[dev-local]   to look it up: netstat -ano | findstr :${port}`
        : `[dev-local]   to look it up: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    );
    return lines;
  }
  for (const { pid, name } of holders) {
    lines.push(`[dev-local] port ${port} is in use by ${name} (process ${pid})`);
    lines.push(
      platform === "win32"
        ? `[dev-local]   to stop it: taskkill /PID ${pid} /F`
        : `[dev-local]   to stop it: kill ${pid}`,
    );
  }
  return lines;
}

async function main() {
  const first = startPort(process.env);
  const port = await findFreePort(first);
  if (port === null) {
    console.error(`[dev-local] no free port found from ${first} to ${first + MAX_TRIES - 1}`);
    process.exit(1);
  }
  if (port !== first) {
    for (const line of conflictHelp(first, portHolders(first))) console.log(line);
    console.log(`[dev-local] using port ${port} instead`);
  }
  console.log(`[dev-local] open http://localhost:${port}`);

  // Put the project's own bin directory on PATH so `vite` resolves when this
  // file is run with plain `node`, not only through `npm run`.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const env = {
    ...process.env,
    [pathKey]: [join(root, "node_modules", ".bin"), process.env[pathKey]]
      .filter(Boolean)
      .join(delimiter),
  };
  const child = spawn(
    process.execPath,
    [
      join(root, "scripts", "with-app-env.mjs"),
      "vite",
      "dev",
      "--host",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    { stdio: "inherit", env, cwd: root },
  );
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    process.exit(exitStatusFromChild(code, signal));
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(`[dev-local] ${err?.message || err}`);
    process.exit(1);
  });
}
