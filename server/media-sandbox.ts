import { runSandboxLoop } from "./media/sandbox.ts";

/**
 * ffmpeg for the media worker. This container has no network. Jobs arrive as
 * files on the shared volume. Docker's seccomp profile blocks unshare, so
 * network isolation is the container, not a new namespace.
 */
const dir = process.env.MEDIA_JOBS_DIR?.trim();
if (!dir) {
  console.error("The media sandbox is unavailable. Set MEDIA_JOBS_DIR.");
  process.exit(1);
}

runSandboxLoop(dir).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
