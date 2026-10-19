import assert from "node:assert/strict";
import test from "node:test";
import { imageBounds, ImageBoundsError, MAX_GIF_FRAMES } from "./bounds.ts";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function gif(width: number, height: number, frames: number): Uint8Array {
  const bytes = [
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61,
    width & 255,
    width >> 8,
    height & 255,
    height >> 8,
    0,
    0,
    0,
  ];
  for (let frame = 0; frame < frames; frame += 1) {
    bytes.push(0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0, 0x02, 0x00);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

test("a small picture is accepted", () => {
  assert.deepEqual(imageBounds(png(8, 8), "image/png"), { width: 8, height: 8, frames: 1 });
  assert.equal(imageBounds(gif(2, 2, 3), "image/gif").frames, 3);
});

test("too many pixels or GIF frames are refused", () => {
  assert.throws(() => imageBounds(png(10_000, 10_000), "image/png"), ImageBoundsError);
  assert.throws(() => imageBounds(gif(2, 2, MAX_GIF_FRAMES + 1), "image/gif"), ImageBoundsError);
});
