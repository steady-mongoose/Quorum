import assert from "node:assert/strict";
import test from "node:test";
import { readHostConfig } from "./config.ts";
import { allowLocalOrigins, parseOrigins } from "./origins.ts";

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

test("localhost follows NODE_ENV and not an https base URL", () => {
  assert.equal(allowLocalOrigins(undefined), true);
  assert.equal(allowLocalOrigins("development"), true);
  assert.equal(allowLocalOrigins("production"), false);

  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    WEB_ORIGINS: process.env.WEB_ORIGINS,
  };
  process.env.DATABASE_URL = "postgres://avouch@127.0.0.1/avouch";
  process.env.BETTER_AUTH_SECRET = "x".repeat(32);
  process.env.BETTER_AUTH_URL = "https://api.avouchsocial.com";
  process.env.WEB_ORIGINS = "https://avouchsocial.com,http://localhost:8080";
  try {
    delete process.env.NODE_ENV;
    const dev = readHostConfig();
    assert.equal(dev.production, false);
    assert.equal(dev.baseURL, "https://api.avouchsocial.com");
    assert.equal(dev.origins.includes("http://localhost:8080"), true);

    process.env.NODE_ENV = "production";
    const prod = readHostConfig();
    assert.equal(prod.production, true);
    assert.equal(prod.origins.includes("http://localhost:8080"), false);
    assert.equal(prod.origins.includes("https://avouchsocial.com"), true);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
