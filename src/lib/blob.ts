import { createHash, createHmac } from "node:crypto";

const LIFETIME_SECONDS = 12 * 3600;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

// Download link for an object in the private B2 bucket, presigned with S3 SigV4 so no SDK is needed.
// Links are signed from the start of the hour, so a page reload reuses the browser's cached audio.
export function signedBlobUrl(key: string, now = new Date()) {
  const { B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_REGION, B2_S3_ENDPOINT } = process.env;
  if (!B2_KEY_ID || !B2_APPLICATION_KEY || !B2_BUCKET || !B2_REGION || !B2_S3_ENDPOINT) return null;
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const amzDate = hour.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const scope = `${amzDate.slice(0, 8)}/${B2_REGION}/s3/aws4_request`;
  const host = `${B2_BUCKET}.${new URL(B2_S3_ENDPOINT).host}`;
  const path = "/" + key.split("/").map(encodeURIComponent).join("/");
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${B2_KEY_ID}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(LIFETIME_SECONDS),
    "X-Amz-SignedHeaders": "host",
  });
  params.sort();
  const query = params.toString().replace(/\+/g, "%20");
  const request = ["GET", path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const signingKey = ["s3", "aws4_request"].reduce<Buffer>((key, part) => hmac(key, part),
    hmac(hmac(`AWS4${B2_APPLICATION_KEY}`, amzDate.slice(0, 8)), B2_REGION));
  const signature = createHmac("sha256", signingKey).update(["AWS4-HMAC-SHA256", amzDate, scope, sha256(request)].join("\n")).digest("hex");
  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
