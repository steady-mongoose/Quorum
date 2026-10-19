export type MediaConfig =
  | { enabled: false; video: false; reason: "unset" | "partial" | "invalid-endpoint" }
  | {
      enabled: true;
      video: boolean;
      endpoint: string;
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    };

function field(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

/**
 * Picture storage stays off until the endpoint, bucket, and both keys are set.
 * Video stays off unless MEDIA_VIDEO is exactly "on". Paid storage needs the
 * owner's OK, so a missing value is the default, not an error.
 */
export function readMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const endpoint = field(env, "MEDIA_S3_ENDPOINT").replace(/\/+$/, "");
  const bucket = field(env, "MEDIA_S3_BUCKET");
  const accessKeyId = field(env, "MEDIA_S3_ACCESS_KEY_ID");
  const secretAccessKey = field(env, "MEDIA_S3_SECRET_ACCESS_KEY");
  const present = [endpoint, bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (present === 0) return { enabled: false, video: false, reason: "unset" };
  if (present < 4) return { enabled: false, video: false, reason: "partial" };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { enabled: false, video: false, reason: "invalid-endpoint" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { enabled: false, video: false, reason: "invalid-endpoint" };
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    return { enabled: false, video: false, reason: "invalid-endpoint" };
  }
  const region = field(env, "MEDIA_S3_REGION") || "us-east-1";
  const pathStyle = field(env, "MEDIA_S3_FORCE_PATH_STYLE").toLowerCase();
  const video = field(env, "MEDIA_VIDEO").toLowerCase() === "on";
  return {
    enabled: true,
    video,
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: pathStyle !== "false",
  };
}

/** Safe to send to the browser. Credentials are not on this object. */
export function publicMediaStatus(config: MediaConfig) {
  return { enabled: config.enabled, video: config.enabled && config.video };
}
