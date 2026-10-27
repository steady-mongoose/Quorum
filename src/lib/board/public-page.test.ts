import assert from "node:assert/strict";
import test from "node:test";
import { acceptSourceUrl } from "./listings.ts";
import { blockedAddress, pageTarget, rebindingHost } from "./public-page.ts";

test("claim fetches refuse private, mapped, and rebinding targets", () => {
  const blocked = [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.4.1",
    "192.168.0.9",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
  ];
  for (const address of blocked) assert.equal(blockedAddress(address), true, address);
  assert.equal(blockedAddress("8.8.8.8"), false);
  assert.equal(blockedAddress("2001:4860:4860::8888"), false);

  for (const host of [
    "nip.io",
    "127.0.0.1.nip.io",
    "foo.localtest.me",
    "a.sslip.io",
    "lvh.me",
    "metadata.google.internal",
    "metadata.goog",
    "localhost",
  ]) {
    assert.equal(rebindingHost(host), true, host);
  }
  assert.equal(rebindingHost("grace.example"), false);
  assert.equal(rebindingHost("notnip.io"), false);

  const refused = [
    "http://127.0.0.1/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[fd00::1]/",
    "http://169.254.169.254/",
    "http://example.com:22/",
    "https://church.nip.io/about",
    "http://foo.localtest.me/",
    "http://metadata.google.internal/computeMetadata/v1/",
  ];
  for (const url of refused) assert.equal(pageTarget(url).ok, false, url);
  const allowed = pageTarget("https://grace.example/about");
  assert.equal(allowed.ok, true);
  if (allowed.ok) {
    assert.equal(allowed.target.port, 443);
    assert.equal(allowed.target.hostname, "grace.example");
  }
  const httpPort = pageTarget("http://grace.example:80/about");
  assert.equal(httpPort.ok, true);

  assert.equal(acceptSourceUrl("https://grace.example/about").ok, true);
  assert.equal(acceptSourceUrl("http://example.com:22/").ok, false);
  assert.equal(acceptSourceUrl("https://127.0.0.1.nip.io/").ok, false);
  assert.equal(acceptSourceUrl("http://[::ffff:127.0.0.1]/").ok, false);
});
