/**
 * The worker process keeps only what it needs to reach Postgres, object
 * storage, and the ffmpeg sandbox. Auth secrets and the database owner
 * password are not on this list.
 */

export const WORKER_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "TZ",
  "NODE_ENV",
  "HOSTNAME",
  "DATABASE_URL",
  "PGHOST",
  "MEDIA_SANDBOX_DIR",
  "MEDIA_S3_ENDPOINT",
  "MEDIA_S3_BUCKET",
  "MEDIA_S3_REGION",
  "MEDIA_S3_ACCESS_KEY_ID",
  "MEDIA_S3_SECRET_ACCESS_KEY",
  "MEDIA_S3_FORCE_PATH_STYLE",
  "MEDIA_VIDEO",
] as const;

export function workerEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const key of WORKER_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** Drop every variable that is not on the worker list. */
export function applyWorkerEnv(target: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = workerEnv(target);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
  return target;
}
