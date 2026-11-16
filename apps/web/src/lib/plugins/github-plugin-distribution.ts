import { sha256Hex } from "./plugin-sha256";
export { sha256Hex } from "./plugin-sha256";
import { parseExtensionManifest, type ExtensionManifest, type PluginManifest } from "@edgeever/plugin-api";
import type { CachedPluginPackage } from "@/lib/plugins/plugin-package-store";
import { api, ApiRequestError } from "@/lib/api";

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_TIMEOUT_MS = 12_000;
const MAX_MAIN_JS_BYTES = 5 * 1024 * 1024;
const MAX_STYLES_CSS_BYTES = 1024 * 1024;
const GITHUB_UNREACHABLE_MESSAGE =
  "Could not read this GitHub plugin from this device or your EdgeEver instance.";

export interface GithubRepositoryCoordinates {
  owner: string;
  repository: string;
  repositoryUrl: string;
}

export interface GithubDownloadedExtension {
  manifest: ExtensionManifest;
  manifestUrl: string;
  repositoryUrl: string;
  releaseTag: string | null;
  pluginPackage: CachedPluginPackage | null;
  checksums: Partial<CachedPluginPackage["checksums"]>;
}

export interface GithubRepositoryManifest {
  manifest: ExtensionManifest;
  manifestText: string;
  manifestUrl: string;
  repositoryUrl: string;
}

export type GithubReleaseAsset = {
  id: number;
  name: string;
  size: number;
  url: string;
  browser_download_url: string;
  digest?: string | null;
};

type GithubReleaseResponse = {
  tag_name: string;
  draft: boolean;
  assets: GithubReleaseAsset[];
};

export const parseGithubRepositoryUrl = (input: string): GithubRepositoryCoordinates | null => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(owner) || !/^[a-z0-9._-]+$/i.test(repository)) return null;
  return { owner, repository, repositoryUrl: `https://github.com/${owner}/${repository}` };
};

const isGithubUnreachableError = (error: unknown) => {
  if (error instanceof TypeError) return true;
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
};

const isGithubRateLimitedStatus = (status: number) => status === 403 || status === 429;

const isMissingGithubAssetError = (error: unknown) => {
  if (error instanceof ApiRequestError && error.status === 404) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 404/i.test(message)
    || /GitHub release was not found/i.test(message)
    || /GitHub Release .+ (was not found|is missing )/i.test(message);
};

const fetchGithubMetadataThroughInstance = async (url: string): Promise<Response> => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname.toLocaleLowerCase() !== "api.github.com") {
    throw new Error("Unsupported GitHub API host.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "repos" || parts.length < 5) throw new Error("Unsupported GitHub API path.");
  const owner = parts[1];
  const repository = parts[2];
  try {
    if (parts[3] === "contents" && parts[4] === "manifest.json") {
      const text = await api.getGithubPluginRepositoryManifest(owner, repository);
      return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (parts[3] === "releases" && parts[4] === "tags" && parts[5]) {
      const release = await api.getGithubPluginRelease(owner, repository, decodeURIComponent(parts[5]));
      if (!release) return new Response(null, { status: 404 });
      return Response.json(release);
    }
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return new Response(null, { status: 404 });
    throw error;
  }
  throw new Error("Unsupported GitHub API path.");
};

const readGithubApi = async (
  request: typeof fetch,
  url: string,
  headers: Record<string, string>,
) => {
  const throughInstance = async () => {
    try {
      return await fetchGithubMetadataThroughInstance(url);
    } catch {
      throw new Error(GITHUB_UNREACHABLE_MESSAGE);
    }
  };
  try {
    const response = await request(url, {
      cache: "no-store",
      credentials: "omit",
      headers,
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    });
    if (isGithubRateLimitedStatus(response.status) || response.status === 401) {
      try {
        return await throughInstance();
      } catch {
        return response;
      }
    }
    return response;
  } catch (error) {
    if (!isGithubUnreachableError(error)) throw error;
    return throughInstance();
  }
};

const readRawGithubManifest = async (
  request: typeof fetch,
  coordinates: GithubRepositoryCoordinates,
) => {
  for (const ref of ["HEAD", "main", "master"]) {
    try {
      const response = await request(
        `https://raw.githubusercontent.com/${coordinates.owner}/${coordinates.repository}/${ref}/manifest.json`,
        { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS) },
      );
      if (response.ok) return response;
    } catch (error) {
      if (!isGithubUnreachableError(error)) throw error;
    }
  }
  return null;
};

const namedReleaseAsset = (name: string): GithubReleaseAsset => ({
  id: 0,
  name,
  size: 0,
  url: "",
  browser_download_url: "",
});

const isGithubApiQuotaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP (401|403|429)/.test(message) || message.includes(GITHUB_UNREACHABLE_MESSAGE);
};

const findRelease = async (request: typeof fetch, coordinates: GithubRepositoryCoordinates, version: string) => {
  let quotaStatus: number | null = null;
  for (const tag of [version, `v${version}`]) {
    const response = await readGithubApi(
      request,
      `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/releases/tags/${encodeURIComponent(tag)}`,
      { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION },
    );
    if (response.status === 404) continue;
    if (isGithubRateLimitedStatus(response.status) || response.status === 401) {
      quotaStatus = response.status;
      continue;
    }
    if (!response.ok) throw new Error(`GitHub release request failed with HTTP ${response.status}.`);
    const release = await response.json() as GithubReleaseResponse;
    if (release.draft) throw new Error("GitHub draft releases cannot be installed.");
    return release;
  }
  if (quotaStatus) throw new Error(`GitHub release request failed with HTTP ${quotaStatus}.`);
  throw new Error(`GitHub Release ${version} or v${version} was not found.`);
};

const requireAsset = (release: GithubReleaseResponse, name: string) => {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`GitHub Release ${release.tag_name} is missing ${name}.`);
  return asset;
};

export type GithubAssetDownloader = (
  coordinates: GithubRepositoryCoordinates,
  releaseTag: string,
  asset: GithubReleaseAsset,
) => Promise<ArrayBuffer>;

const downloadGithubAssetThroughApi: GithubAssetDownloader = async (coordinates, releaseTag, asset) => {
  const assetName = asset.name as "manifest.json" | "main.js" | "styles.css";
  const download = async () => {
    if (asset.id > 0) {
      try {
        return await api.downloadGithubPluginAssetById(
          coordinates.owner,
          coordinates.repository,
          String(asset.id),
          assetName,
        );
      } catch (error) {
        if (!isGithubUnreachableError(error) && !(error instanceof ApiRequestError)) throw error;
      }
    }
    return await api.downloadGithubPluginAsset(
      coordinates.owner,
      coordinates.repository,
      releaseTag,
      assetName,
    );
  };
  try {
    return await download();
  } catch (error) {
    if (isGithubUnreachableError(error)) {
      throw new Error(`Could not download ${assetName} from your EdgeEver instance.`);
    }
    throw error;
  }
};

const downloadAsset = async (
  coordinates: GithubRepositoryCoordinates,
  releaseTag: string,
  asset: GithubReleaseAsset,
  maximumBytes: number,
  download: GithubAssetDownloader,
) => {
  if (asset.size > maximumBytes) throw new Error(`${asset.name} exceeds the allowed package size.`);
  const buffer = await download(coordinates, releaseTag, asset);
  if (buffer.byteLength > maximumBytes) throw new Error(`${asset.name} exceeds the allowed package size.`);
  const checksum = await sha256Hex(buffer);
  if (asset.digest?.startsWith("sha256:") && asset.digest.slice(7).toLocaleLowerCase() !== checksum) {
    throw new Error(`${asset.name} does not match GitHub's SHA-256 digest.`);
  }
  return { buffer, checksum };
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
};

export const extensionManifestsEqual = (left: ExtensionManifest, right: ExtensionManifest) =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const assertReleaseManifest = (repositoryManifest: ExtensionManifest, releaseManifest: ExtensionManifest) => {
  if (repositoryManifest.id !== releaseManifest.id) throw new Error("Release manifest plugin id does not match the repository manifest.");
  if (repositoryManifest.version !== releaseManifest.version) throw new Error("Release manifest version does not match the repository manifest.");
  if (repositoryManifest.type !== releaseManifest.type) throw new Error("Release manifest type does not match the repository manifest.");
  if (!extensionManifestsEqual(repositoryManifest, releaseManifest)) {
    throw new Error("Release manifest does not match the repository manifest.");
  }
};

const assertBundledEntry = (manifest: PluginManifest) => {
  const entryPath = manifest.entry.replace(/^\.\//, "");
  if (entryPath !== "main.js") throw new Error("GitHub plugins must use ./main.js as the bundled entry.");
};

const parseGithubManifestText = (
  coordinates: GithubRepositoryCoordinates,
  manifestText: string,
  manifestUrl: string,
): GithubRepositoryManifest => ({
  manifest: parseExtensionManifest(JSON.parse(manifestText) as unknown),
  manifestText,
  manifestUrl,
  repositoryUrl: coordinates.repositoryUrl,
});

export const loadGithubRepositoryManifest = async (
  input: string,
  request: typeof fetch = window.fetch.bind(window),
): Promise<GithubRepositoryManifest> => {
  const coordinates = parseGithubRepositoryUrl(input);
  if (!coordinates) throw new Error("Enter a public GitHub repository URL such as https://github.com/owner/repository.");
  const manifestUrl = `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/contents/manifest.json`;
  let manifestResponse = await readGithubApi(
    request,
    manifestUrl,
    { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": GITHUB_API_VERSION },
  );
  if (!manifestResponse.ok) {
    manifestResponse = await readRawGithubManifest(request, coordinates)
      ?? (isGithubRateLimitedStatus(manifestResponse.status)
        ? await fetchGithubMetadataThroughInstance(manifestUrl).catch(() => manifestResponse)
        : manifestResponse);
  }
  if (!manifestResponse.ok) throw new Error(`Repository manifest request failed with HTTP ${manifestResponse.status}.`);
  return parseGithubManifestText(coordinates, await manifestResponse.text(), manifestUrl);
};

export const loadGithubInstallableManifest = async (
  input: string,
  request: typeof fetch = window.fetch.bind(window),
): Promise<GithubRepositoryManifest> => {
  const coordinates = parseGithubRepositoryUrl(input);
  if (!coordinates) throw new Error("Enter a public GitHub repository URL such as https://github.com/owner/repository.");
  const latestUrl = `https://github.com/${coordinates.owner}/${coordinates.repository}/releases/latest/download/manifest.json`;
  let lastStatus: number | null = null;

  try {
    const manifestText = await api.getGithubPluginLatestManifest(coordinates.owner, coordinates.repository);
    if (manifestText.trim().length > 0) {
      return parseGithubManifestText(coordinates, manifestText, latestUrl);
    }
  } catch {
    // Instance may be down, unauthenticated in tests, or itself rate-limited by GitHub.
  }

  try {
    const response = await request(latestUrl, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    });
    lastStatus = response.status;
    if (response.ok) {
      const manifestText = await response.text();
      if (manifestText.trim().length > 0) {
        return parseGithubManifestText(coordinates, manifestText, latestUrl);
      }
    }
  } catch (error) {
    if (!isGithubUnreachableError(error)) throw error;
  }

  const rawResponse = await readRawGithubManifest(request, coordinates);
  if (rawResponse?.ok) {
    const manifestText = await rawResponse.text();
    if (manifestText.trim().length > 0) {
      return parseGithubManifestText(
        coordinates,
        manifestText,
        rawResponse.url || `https://raw.githubusercontent.com/${coordinates.owner}/${coordinates.repository}/HEAD/manifest.json`,
      );
    }
  }
  lastStatus = rawResponse?.status ?? lastStatus;

  throw new Error(
    lastStatus
      ? `Latest GitHub plugin release request failed with HTTP ${lastStatus}.`
      : "Could not read the latest GitHub plugin release from this device or your EdgeEver instance.",
  );
};

export const downloadGithubExtension = async (
  input: string,
  request: typeof fetch = window.fetch.bind(window),
  downloadAssetBytes: GithubAssetDownloader = downloadGithubAssetThroughApi,
): Promise<GithubDownloadedExtension> => {
  const coordinates = parseGithubRepositoryUrl(input);
  if (!coordinates) throw new Error("Enter a public GitHub repository URL such as https://github.com/owner/repository.");
  const repository = await loadGithubRepositoryManifest(input, request);
  const { manifest: repositoryManifest, manifestText: repositoryManifestText, manifestUrl } = repository;
  if (repositoryManifest.type === "theme") {
    return {
      manifest: repositoryManifest,
      manifestUrl,
      repositoryUrl: repository.repositoryUrl,
      releaseTag: null,
      pluginPackage: null,
      checksums: { manifestJson: await sha256Hex(repositoryManifestText) },
    };
  }

  assertBundledEntry(repositoryManifest);
  const downloadFromPinnedRelease = async () => {
    const pinned = await downloadPinnedGithubExtension(input, repositoryManifest.version, {
      downloadAssetBytes,
      requireStyles: false,
    });
    assertReleaseManifest(repositoryManifest, pinned.manifest);
    return pinned;
  };

  let release: GithubReleaseResponse;
  try {
    release = await findRelease(request, coordinates, repositoryManifest.version);
  } catch (error) {
    if (!isGithubApiQuotaError(error)) throw error;
    return downloadFromPinnedRelease();
  }
  const manifestAsset = requireAsset(release, "manifest.json");
  const mainAsset = requireAsset(release, "main.js");
  const stylesAsset = release.assets.find((asset) => asset.name === "styles.css") ?? null;
  const [downloadedManifest, downloadedMain, downloadedStyles] = await Promise.all([
    downloadAsset(coordinates, release.tag_name, manifestAsset, 256 * 1024, downloadAssetBytes),
    downloadAsset(coordinates, release.tag_name, mainAsset, MAX_MAIN_JS_BYTES, downloadAssetBytes),
    stylesAsset ? downloadAsset(coordinates, release.tag_name, stylesAsset, MAX_STYLES_CSS_BYTES, downloadAssetBytes) : Promise.resolve(null),
  ]);
  const releaseManifest = parseExtensionManifest(JSON.parse(new TextDecoder().decode(downloadedManifest.buffer)) as unknown);
  assertReleaseManifest(repositoryManifest, releaseManifest);
  if (releaseManifest.type !== "plugin") throw new Error("GitHub Release must contain a plugin manifest.");
  assertBundledEntry(releaseManifest);

  return {
    manifest: releaseManifest,
    manifestUrl: manifestAsset.browser_download_url,
    repositoryUrl: repository.repositoryUrl,
    releaseTag: release.tag_name,
    pluginPackage: {
      pluginId: releaseManifest.id,
      version: releaseManifest.version,
      mainJs: new TextDecoder().decode(downloadedMain.buffer),
      stylesCss: downloadedStyles ? new TextDecoder().decode(downloadedStyles.buffer) : null,
      checksums: {
        manifestJson: downloadedManifest.checksum,
        mainJs: downloadedMain.checksum,
        ...(downloadedStyles ? { stylesCss: downloadedStyles.checksum } : {}),
      },
      cachedAt: new Date().toISOString(),
    },
    checksums: {
      manifestJson: downloadedManifest.checksum,
      mainJs: downloadedMain.checksum,
      ...(downloadedStyles ? { stylesCss: downloadedStyles.checksum } : {}),
    },
  };
};

const downloadOptionalStyles = async (
  coordinates: GithubRepositoryCoordinates,
  releaseTag: string,
  downloadAssetBytes: GithubAssetDownloader,
  requireStyles: boolean,
) => {
  try {
    return await downloadAsset(
      coordinates,
      releaseTag,
      namedReleaseAsset("styles.css"),
      MAX_STYLES_CSS_BYTES,
      downloadAssetBytes,
    );
  } catch (error) {
    if (requireStyles || !isMissingGithubAssetError(error)) throw error;
    return null;
  }
};

const downloadPinnedGithubRelease = async (
  coordinates: GithubRepositoryCoordinates,
  releaseTag: string,
  expectedVersion: string,
  downloadAssetBytes: GithubAssetDownloader,
  requireStyles: boolean,
): Promise<GithubDownloadedExtension> => {
  const downloadedManifest = await downloadAsset(
    coordinates,
    releaseTag,
    namedReleaseAsset("manifest.json"),
    256 * 1024,
    downloadAssetBytes,
  );
  const releaseManifest = parseExtensionManifest(
    JSON.parse(new TextDecoder().decode(downloadedManifest.buffer)) as unknown,
  );
  if (releaseManifest.version !== expectedVersion) {
    throw new Error("Downloaded version does not match the marketplace verified version.");
  }
  const manifestUrl = `https://github.com/${coordinates.owner}/${coordinates.repository}/releases/download/${releaseTag}/manifest.json`;
  if (releaseManifest.type === "theme") {
    return {
      manifest: releaseManifest,
      manifestUrl,
      repositoryUrl: coordinates.repositoryUrl,
      releaseTag,
      pluginPackage: null,
      checksums: { manifestJson: downloadedManifest.checksum },
    };
  }

  assertBundledEntry(releaseManifest);
  const [downloadedMain, downloadedStyles] = await Promise.all([
    downloadAsset(coordinates, releaseTag, namedReleaseAsset("main.js"), MAX_MAIN_JS_BYTES, downloadAssetBytes),
    downloadOptionalStyles(coordinates, releaseTag, downloadAssetBytes, requireStyles),
  ]);

  return {
    manifest: releaseManifest,
    manifestUrl,
    repositoryUrl: coordinates.repositoryUrl,
    releaseTag,
    pluginPackage: {
      pluginId: releaseManifest.id,
      version: releaseManifest.version,
      mainJs: new TextDecoder().decode(downloadedMain.buffer),
      stylesCss: downloadedStyles ? new TextDecoder().decode(downloadedStyles.buffer) : null,
      checksums: {
        manifestJson: downloadedManifest.checksum,
        mainJs: downloadedMain.checksum,
        ...(downloadedStyles ? { stylesCss: downloadedStyles.checksum } : {}),
      },
      cachedAt: new Date().toISOString(),
    },
    checksums: {
      manifestJson: downloadedManifest.checksum,
      mainJs: downloadedMain.checksum,
      ...(downloadedStyles ? { stylesCss: downloadedStyles.checksum } : {}),
    },
  };
};

export const downloadPinnedGithubExtension = async (
  input: string,
  version: string,
  options: {
    downloadAssetBytes?: GithubAssetDownloader;
    requireStyles?: boolean;
  } = {},
): Promise<GithubDownloadedExtension> => {
  const coordinates = parseGithubRepositoryUrl(input);
  if (!coordinates) throw new Error("Enter a public GitHub repository URL such as https://github.com/owner/repository.");
  const downloadAssetBytes = options.downloadAssetBytes ?? downloadGithubAssetThroughApi;
  const requireStyles = Boolean(options.requireStyles);
  let lastError: Error | null = null;
  for (const releaseTag of [version, `v${version}`]) {
    try {
      return await downloadPinnedGithubRelease(
        coordinates,
        releaseTag,
        version,
        downloadAssetBytes,
        requireStyles,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isMissingGithubAssetError(error)) throw lastError;
    }
  }
  throw lastError ?? new Error(`GitHub Release ${version} or v${version} was not found.`);
};
