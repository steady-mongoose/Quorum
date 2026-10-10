import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  DEFAULT_PORT,
  conflictHelp,
  findFreePort,
  isPortFree,
  parseLsofHolders,
  parseNetstatPids,
  parseTasklistName,
  startPort,
} from "./dev-local.mjs";

test("startPort defaults to 8080 and honours a valid PORT", () => {
  assert.equal(startPort({}), DEFAULT_PORT);
  assert.equal(startPort({ PORT: "" }), DEFAULT_PORT);
  assert.equal(startPort({ PORT: "5199" }), 5199);
});

test("startPort rejects a PORT that is not a usable port number", () => {
  for (const bad of ["abc", "0", "70000", "80.5"]) {
    assert.throws(() => startPort({ PORT: bad }), /PORT must be/);
  }
});

test("findFreePort skips ports that are in use", async () => {
  const taken = new Set([8080, 8081]);
  assert.equal(await findFreePort(8080, 50, async (p) => !taken.has(p)), 8082);
});

test("findFreePort gives up after the allowed number of tries", async () => {
  assert.equal(await findFreePort(8080, 3, async () => false), null);
});

test("isPortFree sees a listener bound only to loopback", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    assert.equal(await isPortFree(port), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await isPortFree(port), true);
});

test("parseLsofHolders reads pid and command, once per process", () => {
  // A program listening on IPv4 and IPv6 is reported with one p/c pair and two files.
  assert.deepEqual(parseLsofHolders("p4242\ncPython\nf5\nf6\np99\ncnode\nf20\n"), [
    { pid: 4242, name: "Python" },
    { pid: 99, name: "node" },
  ]);
  assert.deepEqual(parseLsofHolders(""), []);
});

test("parseNetstatPids keeps only listeners on the exact port", () => {
  const out = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       1234",
    "  TCP    [::]:8080              [::]:0                 LISTENING       1234",
    "  TCP    0.0.0.0:18080          0.0.0.0:0              LISTENING       777",
    "  TCP    127.0.0.1:50000        127.0.0.1:8080         ESTABLISHED     555",
  ].join("\r\n");
  assert.deepEqual(parseNetstatPids(out, 8080), [1234]);
});

test("parseTasklistName reads the image name from a CSV row", () => {
  assert.equal(parseTasklistName('"python.exe","1234","Console","1","52,000 K"\r\n'), "python.exe");
  assert.equal(parseTasklistName("INFO: No tasks are running which match the criteria."), null);
});

test("conflictHelp names the holder and the command that stops it", () => {
  assert.deepEqual(conflictHelp(8080, [{ pid: 42, name: "Python" }], "darwin"), [
    "[dev-local] port 8080 is in use by Python (process 42)",
    "[dev-local]   to stop it: kill 42",
  ]);
  assert.match(
    conflictHelp(8080, [{ pid: 42, name: "x.exe" }], "win32")[1],
    /taskkill \/PID 42 \/F/,
  );
  assert.match(conflictHelp(8080, [], "win32")[1], /netstat -ano \| findstr :8080/);
  assert.match(conflictHelp(8080, [], "linux")[1], /lsof -nP -iTCP:8080/);
});
