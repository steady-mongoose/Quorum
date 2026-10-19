import assert from "node:assert/strict";
import test from "node:test";
import { parseOrigins } from "./origins.ts";

test("localhost origins are added only outside production", () => {
  const dev = parseOrigins("https://avouchsocial.com", { production: false });
  assert.equal(dev.includes("http://localhost:8080"), true);
  assert.equal(dev.includes("http://127.0.0.1:8787"), true);

  const prod = parseOrigins("https://avouchsocial.com,http://localhost:8080", { production: true });
  assert.equal(prod.includes("http://localhost:8080"), false);
  assert.equal(prod.includes("http://127.0.0.1:8080"), false);
  assert.equal(prod.includes("https://avouchsocial.com"), true);
  assert.equal(prod.includes("https://www.avouchsocial.com"), true);
});
