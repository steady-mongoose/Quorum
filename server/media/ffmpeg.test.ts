import assert from "node:assert/strict";
import test from "node:test";
import {
  imageFileArgs,
  probeArgs,
  thumbArgs,
  videoFileArgs,
  createFfmpegTools,
  type CommandRunner,
} from "./ffmpeg.ts";
import { MediaReject } from "./errors.ts";

test("ffmpeg commands strip metadata and make a thumbnail", () => {
  assert.equal(imageFileArgs("in.jpg", "out.jpg").includes("-map_metadata"), true);
  assert.equal(imageFileArgs("in.jpg", "out.jpg").includes("-1"), true);
  assert.equal(thumbArgs("in.jpg", "thumb.jpg").includes("-frames:v"), true);
  assert.equal(videoFileArgs("in.mp4", "out.mp4").includes("-map_metadata"), true);
  assert.equal(videoFileArgs("in.mp4", "out.mp4").includes("libx264"), true);
  assert.equal(probeArgs("in.mp4").includes("format=duration"), true);
});

test("pictures still come out when ffmpeg is not installed", async () => {
  const runner: CommandRunner = async () => ({
    code: 127,
    stdout: "",
    stderr: "missing",
    missing: true,
  });
  const tools = createFfmpegTools(runner);
  const bytes = Uint8Array.of(1, 2, 3);
  const image = await tools.processImage(bytes, "image/png");
  assert.equal(image.file, bytes);
  assert.equal(image.fileType, "image/png");
});

test("video is refused when ffmpeg is not installed", async () => {
  const runner: CommandRunner = async () => ({
    code: 127,
    stdout: "",
    stderr: "missing",
    missing: true,
  });
  const tools = createFfmpegTools(runner);
  await assert.rejects(
    () => tools.processVideo(Uint8Array.of(1)),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /ffmpeg/);
      return true;
    },
  );
});

test("a video over 60 seconds is refused after probing", async () => {
  const tools = createFfmpegTools(async (command, args) => {
    if (args[0] === "-version") return { code: 0, stdout: "ffmpeg", stderr: "" };
    if (command === "ffprobe") return { code: 0, stdout: "90\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(
    () => tools.processVideo(Uint8Array.of(1, 2, 3, 4)),
    (error) => {
      assert.ok(error instanceof MediaReject);
      assert.match(error.message, /60 seconds/);
      return true;
    },
  );
});
