import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { apiError, badRequest } from "./http-errors";

const GITHUB_API_VERSION = "2022-11-28";
const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
const REPOSITORY_PATTERN = /^[a-z0-9._-]+$/i;
const ASSET_ID_PATTERN = /^\d+$/;
const RELEASE_TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;
const ASSET_LIMITS = {
  "manifest.json": 256 * 1024,
  "main.js": 5 * 1024 * 1024,
  "styles.css": 1024 * 1024,
} as const;

type SupportedPluginAssetName = keyof typeof ASSET_LIMITS;

const hasValidRepositoryCoordinates = (owner: string, repository: string) =>
  OWNER_PATTERN.test(owner)
  && REPOSITORY_PATTERN.test(repository)
  && repository !== "."
  && repository !== "..";

const readBoundedAsset = async (response: Response, assetName: SupportedPluginAssetName) => {
  if (!response.ok) throw new Error(`GitHub asset ${assetName} failed with HTTP ${response.status}.`);
  const maximumBytes = ASSET_LIMITS[assetName];
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maximumBytes) throw new Error(`${assetName} exceeds the allowed package size.`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maximumBytes) throw new Error(`${assetName} exceeds the allowed package size.`);
  return buffer;
};

export const downloadGithubReleaseAsset = async ({
  owner,
  repository,
  assetId,
  assetName,
  request = fetch,
}: {
  owner: string;
  repository: string;
  assetId: string;
  assetName: SupportedPluginAssetName;
  request?: typeof fetch;
}) => {
  const response = await request(`https://api.github.com/repos/${owner}/${repository}/releases/assets/${assetId}`, {
    redirect: "follow",
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "EdgeEver",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  return readBoundedAsset(response, assetName);
};

export const downloadGithubReleaseAssetByTag = async ({
  owner,
  repository,
  releaseTag,
  assetName,
  request = fetch,
}: {
  owner: string;
  repository: string;
  releaseTag: string;
  assetName: SupportedPluginAssetName;
  request?: typeof fetch;
}) => {
  if (!hasValidRepositoryCoordinates(owner, repository) || !RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw new Error("Invalid GitHub release coordinates.");
  }
  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
  const response = await request(url, {
    redirect: "follow",
    headers: { "User-Agent": "EdgeEver" },
  });
  return readBoundedAsset(response, assetName);
};

export const registerPluginDistributionRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/plugins/github/:owner/:repository/releases/:releaseTag/assets/:assetName", async (context) => {
    const owner = context.req.param("owner");
    const repository = context.req.param("repository");
    const releaseTag = context.req.param("releaseTag");
    const assetName = context.req.param("assetName");
    if (!hasValidRepositoryCoordinates(owner, repository) || !RELEASE_TAG_PATTERN.test(releaseTag)) {
      return badRequest(context, "Invalid GitHub release coordinates.");
    }
    if (!(assetName in ASSET_LIMITS)) return badRequest(context, "Unsupported plugin release asset.");

    try {
      const buffer = await downloadGithubReleaseAssetByTag({
        owner,
        repository,
        releaseTag,
        assetName: assetName as SupportedPluginAssetName,
      });
      return context.body(buffer, 200, {
        "Cache-Control": "private, max-age=300",
        "Content-Type": "application/octet-stream",
      });
    } catch (error) {
      return apiError(
        context,
        "github_asset_download_failed",
        error instanceof Error ? error.message : "GitHub release asset download failed.",
        502,
      );
    }
  });

  app.get("/api/v1/plugins/github/:owner/:repository/assets/:assetId/:assetName", async (context) => {
    const owner = context.req.param("owner");
    const repository = context.req.param("repository");
    const assetId = context.req.param("assetId");
    const assetName = context.req.param("assetName");
    if (!hasValidRepositoryCoordinates(owner, repository) || !ASSET_ID_PATTERN.test(assetId)) {
      return badRequest(context, "Invalid GitHub release asset coordinates.");
    }
    if (!(assetName in ASSET_LIMITS)) return badRequest(context, "Unsupported plugin release asset.");

    try {
      const buffer = await downloadGithubReleaseAsset({
        owner,
        repository,
        assetId,
        assetName: assetName as SupportedPluginAssetName,
      });
      return context.body(buffer, 200, {
        "Cache-Control": "private, max-age=300",
        "Content-Type": "application/octet-stream",
      });
    } catch (error) {
      return apiError(
        context,
        "github_asset_download_failed",
        error instanceof Error ? error.message : "GitHub release asset download failed.",
        502,
      );
    }
  });
};
