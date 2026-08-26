import { createHash, createHmac } from "node:crypto";

const TCR_ENDPOINT = "tcr.tencentcloudapi.com";
const TCR_SERVICE = "tcr";
const TCR_VERSION = "2019-09-24";
const SHA_TAG_PATTERN = /^sha-[0-9a-f]+$/;

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value, encoding) =>
  createHmac("sha256", key).update(value).digest(encoding);

export const selectTcrShaTagsToDelete = (tagInfo, keep = 20) => {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error("keep must be a positive integer");
  }

  return tagInfo
    .filter(({ TagName }) => SHA_TAG_PATTERN.test(TagName))
    .sort((left, right) => {
      const leftTime = left.PushTime || left.CreationTime || "";
      const rightTime = right.PushTime || right.CreationTime || "";
      return (
        rightTime.localeCompare(leftTime) ||
        right.TagName.localeCompare(left.TagName)
      );
    })
    .slice(keep)
    .map(({ TagName }) => TagName);
};

export const createTencentCloudRequest = ({
  action,
  body,
  region,
  secretId,
  secretKey,
  token,
  timestamp = Math.floor(Date.now() / 1000),
}) => {
  const payload = JSON.stringify(body);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = [
    "content-type:application/json; charset=utf-8",
    `host:${TCR_ENDPOINT}`,
    `x-tc-action:${action.toLowerCase()}`,
    "",
  ].join("\n");
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hash(payload),
  ].join("\n");
  const credentialScope = `${date}/${TCR_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestamp,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, TCR_SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  const authorization = [
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    payload,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: TCR_ENDPOINT,
      "X-TC-Action": action,
      "X-TC-Region": region,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": TCR_VERSION,
      ...(token ? { "X-TC-Token": token } : {}),
    },
  };
};

const callTencentCloud = async ({ action, body, credentials }) => {
  const request = createTencentCloudRequest({ action, body, ...credentials });
  const response = await fetch(`https://${TCR_ENDPOINT}`, {
    method: "POST",
    headers: request.headers,
    body: request.payload,
  });
  const result = await response.json();
  const error = result.Response?.Error;
  if (!response.ok || error) {
    throw new Error(
      `${action} failed: ${error?.Code || response.status} ${error?.Message || response.statusText}`,
    );
  }
  return result.Response;
};

export const pruneTcrShaTags = async ({
  repoName,
  keep,
  credentials,
  dryRun = false,
}) => {
  const result = await callTencentCloud({
    action: "DescribeImagePersonal",
    body: { RepoName: repoName, Offset: 0, Limit: 100 },
    credentials,
  });
  const tagsToDelete = selectTcrShaTagsToDelete(
    result.Data?.TagInfo || [],
    keep,
  );

  if (!dryRun) {
    for (let offset = 0; offset < tagsToDelete.length; offset += 20) {
      await callTencentCloud({
        action: "BatchDeleteImagePersonal",
        body: {
          RepoName: repoName,
          Tags: tagsToDelete.slice(offset, offset + 20),
        },
        credentials,
      });
    }
  }

  return tagsToDelete;
};

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  const keep = Number.parseInt(process.env.TCR_SHA_TAGS_TO_KEEP || "20", 10);
  const repoName = process.env.TCR_REPOSITORY || "edgeever/edgeever";
  const credentials = {
    region: process.env.TENCENTCLOUD_REGION || "ap-guangzhou",
    secretId: process.env.TENCENTCLOUD_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
    token: process.env.TENCENTCLOUD_TOKEN,
  };
  if (!credentials.secretId || !credentials.secretKey) {
    throw new Error(
      "TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are required",
    );
  }

  const tagsToDelete = await pruneTcrShaTags({
    repoName,
    keep,
    credentials,
    dryRun: process.argv.includes("--dry-run"),
  });
  console.log(
    tagsToDelete.length === 0
      ? `No sha-* tags need pruning; keeping the latest ${keep}.`
      : `${process.argv.includes("--dry-run") ? "Would delete" : "Deleted"} ${tagsToDelete.length} sha-* tags: ${tagsToDelete.join(", ")}`,
  );
}
