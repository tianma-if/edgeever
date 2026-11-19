import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { fetchCommunityRegistryRelease } from "./community-registry-proxy";
import { apiError, badRequest, notFound } from "./http-errors";

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

class GithubUpstreamError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubUpstreamError";
    this.status = status;
  }
}

export const readGithubRepositoryManifestText = async ({
  owner,
  repository,
  request = fetch,
}: {
  owner: string;
  repository: string;
  request?: typeof fetch;
}) => {
  if (!hasValidRepositoryCoordinates(owner, repository)) throw new Error("Invalid GitHub repository coordinates.");
  const response = await request(`https://api.github.com/repos/${owner}/${repository}/contents/manifest.json`, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "EdgeEver",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (response.status === 404) throw new GithubUpstreamError("Repository manifest was not found.", 404);
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      for (const ref of ["HEAD", "main", "master"] as const) {
        const raw = await request(`https://raw.githubusercontent.com/${owner}/${repository}/${ref}/manifest.json`, {
          headers: { "User-Agent": "EdgeEver" },
        });
        if (raw.ok) {
          const text = await raw.text();
          if (new TextEncoder().encode(text).byteLength > ASSET_LIMITS["manifest.json"]) {
            throw new Error("manifest.json exceeds the allowed package size.");
          }
          return text;
        }
      }
    }
    throw new Error(`Repository manifest request failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > ASSET_LIMITS["manifest.json"]) {
    throw new Error("manifest.json exceeds the allowed package size.");
  }
  return text;
};

const assertManifestSize = (text: string) => {
  if (new TextEncoder().encode(text).byteLength > ASSET_LIMITS["manifest.json"]) {
    throw new Error("manifest.json exceeds the allowed package size.");
  }
  return text;
};

const isRetriableGithubLookupError = (error: unknown) => {
  if (error instanceof GithubUpstreamError) return false;
  return error instanceof Error && !error.message.includes("exceeds the allowed package size");
};

export const readGithubLatestReleaseManifestText = async ({
  owner,
  repository,
  request = fetch,
}: {
  owner: string;
  repository: string;
  request?: typeof fetch;
}) => {
  if (!hasValidRepositoryCoordinates(owner, repository)) throw new Error("Invalid GitHub repository coordinates.");
  try {
    const response = await request(
      `https://github.com/${owner}/${repository}/releases/latest/download/manifest.json`,
      {
        redirect: "follow",
        headers: { "User-Agent": "EdgeEver" },
      },
    );
    if (response.ok) return assertManifestSize(await response.text());
  } catch (error) {
    if (!isRetriableGithubLookupError(error)) throw error;
  }

  try {
    const response = await request(`https://api.github.com/repos/${owner}/${repository}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "EdgeEver",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    });
    if (response.ok) {
      const release = await response.json() as { tag_name?: unknown };
      if (typeof release.tag_name === "string" && RELEASE_TAG_PATTERN.test(release.tag_name)) {
        const buffer = await downloadGithubReleaseAssetByTag({
          owner,
          repository,
          releaseTag: release.tag_name,
          assetName: "manifest.json",
          request,
        });
        return assertManifestSize(new TextDecoder().decode(buffer));
      }
    }
  } catch (error) {
    if (!isRetriableGithubLookupError(error)) throw error;
  }

  return readGithubRepositoryManifestText({ owner, repository, request });
};

export const readGithubReleaseByTag = async ({
  owner,
  repository,
  releaseTag,
  request = fetch,
}: {
  owner: string;
  repository: string;
  releaseTag: string;
  request?: typeof fetch;
}) => {
  if (!hasValidRepositoryCoordinates(owner, repository) || !RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw new Error("Invalid GitHub release coordinates.");
  }
  const response = await request(
    `https://api.github.com/repos/${owner}/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "EdgeEver",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );
  if (response.status === 404) throw new GithubUpstreamError("GitHub release was not found.", 404);
  if (response.status === 403 || response.status === 429) {
    const publicUrl = `https://github.com/${owner}/${repository}/releases/download/${releaseTag}/manifest.json`;
    try {
      const publicManifest = await request(publicUrl, {
        redirect: "follow",
        headers: { "User-Agent": "EdgeEver" },
      });
      if (publicManifest.ok) {
        return {
          tag_name: releaseTag,
          draft: false,
          assets: (["manifest.json", "main.js", "styles.css"] as const).map((name) => ({
            id: 0,
            name,
            size: 0,
            url: "",
            browser_download_url: `https://github.com/${owner}/${repository}/releases/download/${releaseTag}/${name}`,
          })),
        };
      }
    } catch {
      // Keep the original GitHub API status when the public download URL is also blocked.
    }
  }
  if (!response.ok) throw new Error(`GitHub release request failed with HTTP ${response.status}.`);
  const release = await response.json() as {
    tag_name?: unknown;
    draft?: unknown;
    assets?: unknown;
  };
  if (typeof release.tag_name !== "string" || !Array.isArray(release.assets)) {
    throw new Error("GitHub release response is invalid.");
  }
  return {
    tag_name: release.tag_name,
    draft: release.draft === true,
    assets: release.assets.flatMap((asset) => {
      if (!asset || typeof asset !== "object") return [];
      const record = asset as Record<string, unknown>;
      if (typeof record.id !== "number" || typeof record.name !== "string" || typeof record.size !== "number") return [];
      if (typeof record.url !== "string" || typeof record.browser_download_url !== "string") return [];
      return [{
        id: record.id,
        name: record.name,
        size: record.size,
        url: record.url,
        browser_download_url: record.browser_download_url,
        ...(typeof record.digest === "string" ? { digest: record.digest } : {}),
      }];
    }),
  };
};

const githubUpstreamError = (context: Parameters<typeof apiError>[0], error: unknown) => {
  if (error instanceof GithubUpstreamError && error.status === 404) return notFound(context, error.message);
  return apiError(
    context,
    "github_metadata_request_failed",
    error instanceof Error ? error.message : "GitHub plugin metadata request failed.",
    502,
  );
};

const alternateGithubReleaseTag = (releaseTag: string) => {
  if (releaseTag.startsWith("v") && RELEASE_TAG_PATTERN.test(releaseTag.slice(1))) return releaseTag.slice(1);
  const prefixed = `v${releaseTag}`;
  if (!releaseTag.startsWith("v") && RELEASE_TAG_PATTERN.test(prefixed)) return prefixed;
  return null;
};

const githubReleaseTagCandidates = (releaseTag: string) => {
  const alternate = alternateGithubReleaseTag(releaseTag);
  return alternate && alternate !== releaseTag ? [releaseTag, alternate] : [releaseTag];
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
  const tags = githubReleaseTagCandidates(releaseTag);
  let lastError: unknown;
  for (const tag of tags) {
    const url = `https://github.com/${owner}/${repository}/releases/download/${tag}/${assetName}`;
    try {
      const response = await request(url, {
        redirect: "follow",
        headers: { "User-Agent": "EdgeEver" },
      });
      return await readBoundedAsset(response, assetName);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.includes("exceeds the allowed package size")) throw error;
    }
  }

  for (const tag of tags) {
    try {
      const release = await readGithubReleaseByTag({ owner, repository, releaseTag: tag, request });
      const asset = release.assets.find((candidate) => candidate.name === assetName);
      if (!asset) {
        lastError = new GithubUpstreamError(`GitHub Release ${tag} is missing ${assetName}.`, 404);
        continue;
      }
      return downloadGithubReleaseAsset({
        owner,
        repository,
        assetId: String(asset.id),
        assetName,
        request,
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof GithubUpstreamError && error.status === 404)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new GithubUpstreamError(`GitHub Release ${releaseTag} is missing ${assetName}.`, 404);
};

const PLUGIN_MANIFEST_CACHE_TTL_MS = 300_000;
const PLUGIN_MANIFEST_CACHE_LIMIT = 64;
const pluginManifestMemoryCache = new Map<string, { text: string; expiresAt: number }>();
const pluginManifestRequests = new Map<string, Promise<string>>();

const readCachedPluginManifest = (key: string) => {
  const entry = pluginManifestMemoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    pluginManifestMemoryCache.delete(key);
    return null;
  }
  return entry.text;
};

const writeCachedPluginManifest = (key: string, text: string) => {
  if (pluginManifestMemoryCache.size >= PLUGIN_MANIFEST_CACHE_LIMIT) {
    const oldest = pluginManifestMemoryCache.keys().next().value;
    if (typeof oldest === "string") pluginManifestMemoryCache.delete(oldest);
  }
  pluginManifestMemoryCache.set(key, { text, expiresAt: Date.now() + PLUGIN_MANIFEST_CACHE_TTL_MS });
};

const loadCachedPluginManifest = (key: string, load: () => Promise<string>) => {
  const cached = readCachedPluginManifest(key);
  if (cached !== null) return Promise.resolve(cached);
  const pending = pluginManifestRequests.get(key);
  if (pending) return pending;
  const request = Promise.resolve().then(load).then(text => {
    writeCachedPluginManifest(key, text);
    return text;
  }).finally(() => { pluginManifestRequests.delete(key); });
  pluginManifestRequests.set(key, request);
  return request;
};

const respondWithGithubManifestText = (
  context: { text: (body: string, status: number, headers: Record<string, string>) => Response },
  text: string,
) => context.text(text, 200, {
  "Cache-Control": "private, max-age=300",
  "Content-Type": "application/json; charset=utf-8",
});

export const registerPluginDistributionRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/plugins/community-registry", async (context) => {
    const configured = context.env.EDGE_EVER_COMMUNITY_REGISTRY_URL;
    if (!configured?.trim()) return notFound(context, "Community registry is not configured.");
    try {
      const transport = context.env.publicNetworkFetch;
      const release = await fetchCommunityRegistryRelease({
        registryUrl: configured,
        request: (input, init) => {
          if (!transport) return fetch(input, init);
          const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          return transport(target, init ?? {});
        },
      });
      return context.body(release.registryBytes, 200, {
        "Cache-Control": "private, max-age=60",
        "Content-Type": "application/json; charset=utf-8",
        "X-EdgeEver-Community-Registry-Signature": release.signatureBase64,
      });
    } catch (error) {
      return apiError(
        context,
        "community_registry_unavailable",
        error instanceof Error ? error.message : "Community registry is unavailable.",
        502,
      );
    }
  });

  app.get("/api/v1/plugins/github/:owner/:repository/latest-manifest", async (context) => {
    const owner = context.req.param("owner");
    const repository = context.req.param("repository");
    if (!hasValidRepositoryCoordinates(owner, repository)) {
      return badRequest(context, "Invalid GitHub repository coordinates.");
    }
    const cacheKey = `latest:${owner}/${repository}`;
    try {
      const text = await loadCachedPluginManifest(cacheKey, () => readGithubLatestReleaseManifestText({ owner, repository }));
      return respondWithGithubManifestText(context, text);
    } catch (error) {
      return githubUpstreamError(context, error);
    }
  });

  app.get("/api/v1/plugins/github/:owner/:repository/manifest", async (context) => {
    const owner = context.req.param("owner");
    const repository = context.req.param("repository");
    if (!hasValidRepositoryCoordinates(owner, repository)) {
      return badRequest(context, "Invalid GitHub repository coordinates.");
    }
    const cacheKey = `branch:${owner}/${repository}`;
    try {
      const text = await loadCachedPluginManifest(cacheKey, () => readGithubRepositoryManifestText({ owner, repository }));
      return respondWithGithubManifestText(context, text);
    } catch (error) {
      return githubUpstreamError(context, error);
    }
  });

  app.get("/api/v1/plugins/github/:owner/:repository/releases/tags/:releaseTag", async (context) => {
    const owner = context.req.param("owner");
    const repository = context.req.param("repository");
    const releaseTag = context.req.param("releaseTag");
    if (!hasValidRepositoryCoordinates(owner, repository) || !RELEASE_TAG_PATTERN.test(releaseTag)) {
      return badRequest(context, "Invalid GitHub release coordinates.");
    }
    try {
      const release = await readGithubReleaseByTag({ owner, repository, releaseTag });
      context.header("Cache-Control", "private, max-age=60");
      return context.json(release);
    } catch (error) {
      return githubUpstreamError(context, error);
    }
  });

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
      if (error instanceof GithubUpstreamError && error.status === 404) {
        return githubUpstreamError(context, error);
      }
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
        "Cache-Control": "private, max-age=86400, immutable",
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
