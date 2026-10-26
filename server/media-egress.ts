import { egressTarget, startEgressProxy } from "./media/egress.ts";

/**
 * Forwards one storage host for the media worker. The worker network has no
 * default route, so this process is the only way out.
 */
export async function main(): Promise<void> {
  let target;
  try {
    target = egressTarget(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  await startEgressProxy(target);
  console.log(JSON.stringify({ event: "media-egress", host: target.host, port: target.port }));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
