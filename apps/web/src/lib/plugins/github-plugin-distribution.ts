import { parseExtensionManifest, type ExtensionManifest, type PluginManifest } from "@edgeever/plugin-api";
import type { CachedPluginPackage } from "@/lib/plugins/plugin-package-store";
import { api } from "@/lib/api";

const GITHUB_API_VERSION = "2022-11-28";
const MAX_MAIN_JS_BYTES = 5 * 1024 * 1024;
const MAX_STYLES_CSS_BYTES = 1024 * 1024;

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

export const sha256Hex = async (value: string | ArrayBuffer) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const findRelease = async (request: typeof fetch, coordinates: GithubRepositoryCoordinates, version: string) => {
  for (const tag of [version, `v${version}`]) {
    const response = await request(
      `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/releases/tags/${encodeURIComponent(tag)}`,
      {
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION },
      }
    );
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`GitHub release request failed with HTTP ${response.status}.`);
    const release = await response.json() as GithubReleaseResponse;
    if (release.draft) throw new Error("GitHub draft releases cannot be installed.");
    return release;
  }
  throw new Error(`GitHub Release ${version} or v${version} was not found.`);
};

const requireAsset = (release: GithubReleaseResponse, name: string) => {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`GitHub Release ${release.tag_name} is missing ${name}.`);
  return asset;
};

type GithubAssetDownloader = (
  coordinates: GithubRepositoryCoordinates,
  asset: GithubReleaseAsset,
) => Promise<ArrayBuffer>;

const downloadGithubAssetThroughApi: GithubAssetDownloader = (coordinates, asset) =>
  api.downloadGithubPluginAsset(
    coordinates.owner,
    coordinates.repository,
    asset.id,
    asset.name as "manifest.json" | "main.js" | "styles.css",
  );

const downloadAsset = async (
  coordinates: GithubRepositoryCoordinates,
  asset: GithubReleaseAsset,
  maximumBytes: number,
  download: GithubAssetDownloader,
) => {
  if (asset.size > maximumBytes) throw new Error(`${asset.name} exceeds the allowed package size.`);
  const buffer = await download(coordinates, asset);
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

export const loadGithubRepositoryManifest = async (
  input: string,
  request: typeof fetch = window.fetch.bind(window),
): Promise<GithubRepositoryManifest> => {
  const coordinates = parseGithubRepositoryUrl(input);
  if (!coordinates) throw new Error("Enter a public GitHub repository URL such as https://github.com/owner/repository.");
  const manifestUrl = `https://api.github.com/repos/${coordinates.owner}/${coordinates.repository}/contents/manifest.json`;
  const manifestResponse = await request(manifestUrl, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": GITHUB_API_VERSION },
  });
  if (!manifestResponse.ok) throw new Error(`Repository manifest request failed with HTTP ${manifestResponse.status}.`);
  const manifestText = await manifestResponse.text();
  return {
    manifest: parseExtensionManifest(JSON.parse(manifestText) as unknown),
    manifestText,
    manifestUrl,
    repositoryUrl: coordinates.repositoryUrl,
  };
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
  const release = await findRelease(request, coordinates, repositoryManifest.version);
  const manifestAsset = requireAsset(release, "manifest.json");
  const mainAsset = requireAsset(release, "main.js");
  const stylesAsset = release.assets.find((asset) => asset.name === "styles.css") ?? null;
  const [downloadedManifest, downloadedMain, downloadedStyles] = await Promise.all([
    downloadAsset(coordinates, manifestAsset, 256 * 1024, downloadAssetBytes),
    downloadAsset(coordinates, mainAsset, MAX_MAIN_JS_BYTES, downloadAssetBytes),
    stylesAsset ? downloadAsset(coordinates, stylesAsset, MAX_STYLES_CSS_BYTES, downloadAssetBytes) : Promise.resolve(null),
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
