import { createHash, createHmac } from "node:crypto";

const LIFETIME_SECONDS = 12 * 3600;
const UPLOAD_LIFETIME_SECONDS = 3600;
const SERVER_LIFETIME_SECONDS = 300;
// More versions than this means something is uploading the key in a loop; stop rather than chase it.
const MAX_VERSIONS = 20;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

// Download link for an object in the private B2 bucket, presigned with S3 SigV4 so no SDK is needed.
// Links are signed from the start of the hour, so a page reload reuses the browser's cached audio.
export function signedBlobUrl(key: string, now = new Date()) {
  return presign("GET", key, new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000), LIFETIME_SECONDS);
}

// Upload link for a browser to PUT one object, such as a recorded session, straight to the bucket.
// The bucket's CORS rules must allow PUT from the app's origin.
export function signedBlobUploadUrl(key: string, now = new Date()) {
  return presign("PUT", key, now, UPLOAD_LIFETIME_SECONDS);
}

/**
 * Deletes an object and every stored version of it. B2 keeps versions, so a plain S3 delete only hides
 * the file and it is still stored and billed; instead each version is found with HEAD and deleted by id.
 * Returns false when storage is not configured; throws if a version could not be deleted.
 */
export async function deleteBlob(key: string) {
  for (let deleted = 0; deleted < MAX_VERSIONS; deleted++) {
    const head = presign("HEAD", key, new Date(), SERVER_LIFETIME_SECONDS);
    if (!head) return false;
    const found = await fetch(head, { method: "HEAD" });
    if (found.status === 404) return true;
    const versionId = found.headers.get("x-amz-version-id");
    if (!found.ok || !versionId) throw new Error(`Could not look up ${key}: HTTP ${found.status}`);
    const removed = await fetch(presign("DELETE", key, new Date(), SERVER_LIFETIME_SECONDS, { versionId })!, { method: "DELETE" });
    if (!removed.ok && removed.status !== 404) throw new Error(`Could not delete ${key}: HTTP ${removed.status}`);
  }
  throw new Error(`${key} still has versions after ${MAX_VERSIONS} deletes`);
}

function presign(method: "GET" | "PUT" | "HEAD" | "DELETE", key: string, signedAt: Date, lifetime: number, extra: Record<string, string> = {}) {
  const { B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_REGION, B2_S3_ENDPOINT } = process.env;
  if (!B2_KEY_ID || !B2_APPLICATION_KEY || !B2_BUCKET || !B2_REGION || !B2_S3_ENDPOINT) return null;
  const amzDate = signedAt.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const scope = `${amzDate.slice(0, 8)}/${B2_REGION}/s3/aws4_request`;
  const host = `${B2_BUCKET}.${new URL(B2_S3_ENDPOINT).host}`;
  const path = "/" + key.split("/").map(encodeURIComponent).join("/");
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${B2_KEY_ID}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(lifetime),
    "X-Amz-SignedHeaders": "host",
    ...extra,
  });
  params.sort();
  const query = params.toString().replace(/\+/g, "%20");
  const request = [method, path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const signingKey = ["s3", "aws4_request"].reduce<Buffer>((key, part) => hmac(key, part),
    hmac(hmac(`AWS4${B2_APPLICATION_KEY}`, amzDate.slice(0, 8)), B2_REGION));
  const signature = createHmac("sha256", signingKey).update(["AWS4-HMAC-SHA256", amzDate, scope, sha256(request)].join("\n")).digest("hex");
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
