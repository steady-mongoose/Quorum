// @ts-check
/**
 * Upload one age-encrypted dump to S3-compatible storage.
 * All four credential values blank: print a line and exit 0.
 * A partial set throws. The script does not delete remote objects.
 *
 *   node scripts/backup-offsite.mjs /var/backups/avouch/avouch-STAMP.dump.age
 */
import { spawn } from "node:child_process";
import { basename } from "node:path";

const DUMP_NAME = /^avouch-\d{8}T\d{6}Z\.dump\.age$/;

/**
 * @param {string | undefined} value
 */
function trim(value) {
  return (value ?? "").trim();
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} filePath
 * @param {number} nowMs
 */
export function offsitePlan(env, filePath, nowMs) {
  const bucket = trim(env.BACKUP_S3_BUCKET);
  const endpoint = trim(env.BACKUP_S3_ENDPOINT);
  const accessKeyId = trim(env.BACKUP_S3_ACCESS_KEY_ID);
  const secretAccessKey = trim(env.BACKUP_S3_SECRET_ACCESS_KEY);
  const filled = [bucket, endpoint, accessKeyId, secretAccessKey].filter(Boolean);
  if (filled.length === 0) return { enabled: false, args: [], childEnv: {} };
  if (filled.length !== 4) {
    throw new Error(
      "Set BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, and BACKUP_S3_SECRET_ACCESS_KEY together, or leave all four blank.",
    );
  }
  const name = basename(filePath);
  if (!DUMP_NAME.test(name)) {
    throw new Error("Refusing to upload a file that is not an age-encrypted Avouch dump.");
  }
  const lockRaw = trim(env.BACKUP_S3_OBJECT_LOCK).toUpperCase() || "COMPLIANCE";
  /** @type {string | null} */
  let lock = null;
  if (lockRaw === "OFF" || lockRaw === "NONE") lock = null;
  else if (lockRaw === "COMPLIANCE" || lockRaw === "GOVERNANCE") lock = lockRaw;
  else throw new Error("BACKUP_S3_OBJECT_LOCK must be COMPLIANCE, GOVERNANCE, or off.");
  const days = Number(trim(env.BACKUP_RETENTION_DAYS) || "14");
  if (!Number.isFinite(days) || days < 1) throw new Error("BACKUP_RETENTION_DAYS must be at least 1.");
  const region = trim(env.BACKUP_S3_REGION) || "auto";
  const retainUntil = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const args = [
    "s3api",
    "put-object",
    "--endpoint-url",
    endpoint,
    "--region",
    region,
    "--bucket",
    bucket,
    "--key",
    `avouch/${name}`,
    "--body",
    filePath,
  ];
  if (lock) args.push("--object-lock-mode", lock, "--object-lock-retain-until-date", retainUntil);
  return {
    enabled: true,
    args,
    childEnv: {
      AWS_ACCESS_KEY_ID: accessKeyId,
      AWS_SECRET_ACCESS_KEY: secretAccessKey,
      AWS_EC2_METADATA_DISABLED: "true",
    },
  };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url.endsWith(entry.replaceAll("\\", "/")));
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node scripts/backup-offsite.mjs <avouch-STAMP.dump.age>");
    process.exit(1);
  }
  const plan = offsitePlan(process.env, filePath, Date.now());
  if (!plan.enabled) {
    console.log("Off-site copy is disabled until credentials are provided.");
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn("aws", plan.args, {
      env: { ...process.env, ...plan.childEnv },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`aws s3api put-object exited ${code ?? "unknown"}.`));
    });
  });
}

if (isMain()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Off-site copy failed.");
    process.exit(1);
  });
}
