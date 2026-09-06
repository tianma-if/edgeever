import { join, resolve } from "node:path";

const SUPPORTED_STORAGE_BACKENDS = new Set(["local", "s3"]);

const parseInteger = (value, fallback, name, minimum, maximum) => {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
};

export const resolveSelfHostedConfig = (environment = process.env, projectRoot = process.cwd()) => {
  const dataDirectory = resolve(environment.EDGE_EVER_DATA_DIR ?? join(projectRoot, ".edgeever-data"));
  const storageBackend = (environment.EDGE_EVER_STORAGE_BACKEND ?? "local").trim().toLowerCase();

  if (!SUPPORTED_STORAGE_BACKENDS.has(storageBackend)) {
    throw new Error("EDGE_EVER_STORAGE_BACKEND must be either local or s3");
  }
  if (storageBackend === "s3" && !environment.EDGE_EVER_S3_BUCKET?.trim()) {
    throw new Error("EDGE_EVER_S3_BUCKET is required when EDGE_EVER_STORAGE_BACKEND=s3");
  }

  return {
    dataDirectory,
    databaseFile: resolve(environment.EDGE_EVER_SQLITE_FILE ?? join(dataDirectory, "edgeever.sqlite")),
    resourcesDirectory: resolve(environment.EDGE_EVER_RESOURCES_DIR ?? join(dataDirectory, "resources")),
    webDirectory: resolve(environment.EDGE_EVER_WEB_DIR ?? join(projectRoot, "apps/web/dist")),
    hostname: environment.EDGE_EVER_HOST?.trim() || "0.0.0.0",
    port: parseInteger(environment.PORT ?? environment.EDGE_EVER_PORT, 8787, "EDGE_EVER_PORT", 1, 65_535),
    idleTimeout: parseInteger(
      environment.EDGE_EVER_IDLE_TIMEOUT_SECONDS,
      120,
      "EDGE_EVER_IDLE_TIMEOUT_SECONDS",
      10,
      255,
    ),
    storageBackend,
  };
};
