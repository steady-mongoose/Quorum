#!/usr/bin/env node
/**
 * Runs the template script tests and the app/server tests.
 * The second suite always starts, even when the first suite fails, so a
 * pre-existing script failure cannot hide the closed-test tests.
 */
import { spawn } from "node:child_process";

const appTests = [
  "src/lib/board/rsvp-admin-only.test.ts",
  "scripts/externalize-inline-scripts.test.mjs",
  "src/lib/api-base.test.ts",
  "src/lib/api-mode.test.ts",
  "src/lib/account-api.test.ts",
  "src/lib/board/design-review.test.ts",
  "src/lib/board/landing-header.test.ts",
  "src/lib/board/interactions.test.ts",
  "src/lib/board/fonts.test.ts",
  "src/lib/board/public-gathering.test.ts",
  "src/lib/board/engraved.test.ts",
  "src/lib/board/phone-nav.test.ts",
  "src/lib/board/more-menu.render.test.mjs",
  "src/lib/board/audience.render.test.mjs",
  "src/lib/board/confirm-dialog.render.test.mjs",
  "src/lib/board/design-followup.test.ts",
  "src/lib/board/removal-confirm.test.ts",
  "src/lib/board/design-critic.test.ts",
  "src/lib/board/about-mission.test.ts",
  "src/lib/app-data/app-data.test.ts",
  "src/lib/app-data/readiness-schedule.test.ts",
  "src/lib/auth/gate-identity.test.ts",
  "src/lib/auth/sign-in-gate.test.ts",
  "src/lib/e2ee/limits.test.ts",
  "src/lib/e2ee/vault-wrap.test.ts",
  "src/lib/e2ee/browser.test.ts",
  "src/lib/e2ee/protocol.test.ts",
  "src/lib/e2ee/media-strip.test.ts",
  "src/lib/e2ee/media-crypto.test.ts",
  "src/lib/e2ee/media-bridge.test.ts",
  "server/dm/store.test.ts",
  "server/dm/mailbox.integration.test.ts",
  "workers/frontend.test.ts",
  "server/origins.test.ts",
  "server/proxy.test.ts",
  "server/rate-limit.test.ts",
  "server/env-file.test.ts",
  "server/http.test.ts",
  "server/closed-test/rules.test.ts",
  "server/closed-test/store.test.ts",
  "server/closed-test/schema.test.ts",
  "server/closed-test/auth.integration.test.ts",
  "server/closed-test/signup-limit.integration.test.ts",
  "src/lib/signup-feedback.test.ts",
  "server/media/limits.test.ts",
  "server/media/config.test.ts",
  "server/media/s3.test.ts",
  "server/media/strip.test.ts",
  "server/media/ffmpeg.test.ts",
  "server/media/output.test.ts",
  "server/media/schema.test.ts",
  "server/media/service.test.ts",
  "server/media/worker.test.ts",
  "server/media/http.test.ts",
  "server/media/ip.test.ts",
  "server/media/sandbox.test.ts",
  "server/media/worker-env.test.ts",
  "server/media/egress.test.ts",
  "server/calls/config.test.ts",
  "server/calls/store.test.ts",
  "server/calls/evict.test.ts",
  "server/calls/http.test.ts",
  "server/calls/compose.test.ts",
  "src/lib/calls/ice.test.ts",
  "src/lib/calls/status.test.ts",
  "src/lib/calls/negotiate.test.ts",
  "src/lib/calls/session.test.ts",
  "src/lib/calls/media.test.ts",
  "src/lib/calls/rings.test.ts",
  "server/calls/dm-calls.test.ts",
  "server/calls/cloudflare-turn.test.ts",
  "server/calls/rings.test.ts",
  "src/lib/board/call-rings.render.test.mjs",
  "src/lib/board/call-panel.render.test.mjs",
  "src/lib/media/bounds.test.ts",
  "src/lib/media/e2e.test.ts",
  "src/lib/media/upload.test.ts",
  "src/lib/board/text.test.ts",
  "src/lib/board/api.test.ts",
  "src/lib/board/categories.test.ts",
  "src/lib/board/rooms-admin.test.ts",
  "src/lib/board/route-head.test.ts",
  "src/lib/board/room-layout.test.ts",
  "src/lib/board/store.test.ts",
  "src/lib/board/clear-board.test.ts",
  "src/lib/board/chat.test.ts",
  "src/lib/board/home.test.ts",
  "src/lib/board/group-client.test.ts",
  "src/lib/board/access-rules.test.ts",
  "src/lib/board/room-requests.test.ts",
  "src/lib/board/council.test.ts",
  "server/board/account.test.ts",
  "src/lib/board/delete-post.render.test.mjs",
  "src/lib/board/claim-policy.test.ts",
  "src/lib/board/claim-design.test.ts",
  "src/lib/board/public-page.test.ts",
  "server/board/ban-check.test.ts",
  "server/board/order.test.ts",
  "server/board/store.test.ts",
  "server/board/csam.test.ts",
  "server/security-log-purge.test.ts",
  "server/board/alert-mail.test.ts",
  "server/board/places-store.test.ts",
  "server/board/http.test.ts",
  "server/board/categories.test.ts",
  "server/board/categories.postgres.test.ts",
  "server/board/rooms-admin.test.ts",
  "server/board/rooms-admin.postgres.test.ts",
  "server/board/claims.test.ts",
  "server/board/public-fetch.test.ts",
  "server/board/claim-attempts.pg.test.ts",
  "server/board/public-gathering.test.ts",
  "server/board/groups.test.ts",
  "server/board/audience.test.ts",
  "server/gender-policy.test.ts",
  "server/profile/fields.test.ts",
  "server/profile/schema.test.ts",
  "server/profile/view.test.ts",
  "server/profile/http.test.ts",
  "server/board/groups-http.test.ts",
  "server/chat/store.test.ts",
  "server/chat/http.test.ts",
];

const suites = [
  [process.execPath, ["--test", "scripts/**/*.test.mjs"]],
  [process.execPath, ["--experimental-strip-types", "--test", ...appTests]],
];

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const only = process.argv[2];
const selected =
  only === "app" ? suites.slice(1) : only === "scripts" ? suites.slice(0, 1) : suites;
if (only && only !== "app" && only !== "scripts") {
  console.error("Usage: node scripts/run-tests.mjs [app|scripts]");
  process.exit(1);
}

let failed = 0;
for (const [command, args] of selected) {
  const code = await run(command, args);
  if (code !== 0) failed = code;
}
process.exit(failed);
