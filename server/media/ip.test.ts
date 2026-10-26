import assert from "node:assert/strict";
import test from "node:test";
import { uploadIpKey } from "./ip.ts";

test("an IPv6 upload limit uses the /64", () => {
  const one = uploadIpKey("2001:db8:1:2::1");
  const two = uploadIpKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
  const other = uploadIpKey("2001:db8:1:3::1");
  assert.equal(one, two);
  assert.equal(one, "upload-ip:2001:0db8:0001:0002::/64");
  assert.notEqual(one, other);
});

test("an IPv4 address stays whole, including a mapped address", () => {
  assert.equal(uploadIpKey("203.0.113.8"), "upload-ip:203.0.113.8");
  assert.equal(uploadIpKey("::ffff:203.0.113.8"), "upload-ip:203.0.113.8");
});
