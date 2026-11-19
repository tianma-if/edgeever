import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { stubUnavailableGithubInstance } from "./github-plugin-test-api.mjs";
import { createMemoryCommunityRegistryStorage } from "./community-registry-store.ts";
import { loadDisplayPluginMarketplace } from "./community-registry.ts";
import { communityPluginSubmissionIssueUrl } from "./community-plugin-submission.ts";

const bundledEntry = {
  id: "org.edgeever.tasks",
  name: "Tasks",
  description: "Official tasks",
  author: "EdgeEver",
  publisher: "edgeever",
  category: "Productivity",
  repositoryUrl: "https://github.com/tianma-if/edgeever-tasks",
  distribution: { type: "github", repositoryUrl: "https://github.com/tianma-if/edgeever-tasks" },
  verification: { version: "0.6.4", checksums: { manifestJson: "a".repeat(64), mainJs: "b".repeat(64) } },
};

const communityEntry = {
  id: "com.example.readwise",
  name: "Readwise",
  description: "Imports highlights.",
  author: "Example",
  category: "Import",
  repositoryUrl: "https://github.com/example/readwise",
  distribution: { type: "github", repositoryUrl: "https://github.com/example/readwise" },
  verification: { version: "1.2.0", checksums: { manifestJson: "c".repeat(64), mainJs: "d".repeat(64) } },
  apiVersion: "2",
  licenseSpdx: "MIT",
};

const registryDocument = (entries, extra = {}) => JSON.stringify({
  registryVersion: "1",
  updatedAt: "2026-10-05T00:00:00.000Z",
  entries,
  ...extra,
});

const signingKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = new Uint8Array(publicKey.export({ format: "der", type: "spki" })).subarray(-32);
  return { raw, privateKey };
};

const signedRelease = (privateKey, text, updatedAt = "2026-10-05T00:00:00.000Z") => {
  const body = text.includes("\"updatedAt\"")
    ? text
    : text;
  const bytes = new TextEncoder().encode(body);
  const signature = sign(null, bytes, privateKey);
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    signatureBase64: Buffer.from(signature).toString("base64"),
    updatedAt,
  };
};

const bundledRequest = async (input) => {
  const url = String(input);
  if (url.includes("registry.json")) {
    return Response.json({
      registryVersion: "1",
      updatedAt: "2026-10-01T00:00:00.000Z",
      entries: [bundledEntry],
    });
  }
  return new Response("missing", { status: 404 });
};

let restoreGithubInstance;
beforeAll(() => {
  if (!globalThis.window) {
    globalThis.window = {
      location: { href: "https://app.example/index.html" },
      fetch: () => Promise.reject(new Error("unexpected browser fetch")),
    };
  }
  restoreGithubInstance = stubUnavailableGithubInstance();
});
afterAll(() => { restoreGithubInstance?.(); });

describe("signed community registry", () => {
  test("merges a verified catalog and keeps it when a later signature fails", async () => {
    const { raw, privateKey } = signingKey();
    const storage = createMemoryCommunityRegistryStorage();
    const release = signedRelease(privateKey, registryDocument([communityEntry]));
    const first = await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => release,
      storage,
      publicKeys: [raw],
      instanceKey: "https://official.example",
    });

    expect(first.community).toBe("refreshed");
    expect(first.entries.map((entry) => entry.id)).toEqual(["org.edgeever.tasks", "com.example.readwise"]);
    expect(first.entries[1]).toMatchObject({ listing: "community", licenseSpdx: "MIT" });
    expect(first.entries[0].repositoryUrl).toBe(bundledEntry.repositoryUrl);

    const retained = await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => ({ bytes: release.bytes, signatureBase64: Buffer.from("nope").toString("base64") }),
      storage,
      publicKeys: [raw],
      instanceKey: "https://official.example",
    });

    expect(retained.community).toBe("retained");
    expect(retained.entries.map((entry) => entry.id)).toEqual(["org.edgeever.tasks", "com.example.readwise"]);
  });

  test("drops the community catalog when the instance has not configured it", async () => {
    const { raw, privateKey } = signingKey();
    const storage = createMemoryCommunityRegistryStorage();
    const release = signedRelease(privateKey, registryDocument([communityEntry]));
    await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => release,
      storage,
      publicKeys: [raw],
      instanceKey: "https://official.example",
    });

    const disabled = await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => null,
      storage,
      publicKeys: [raw],
      instanceKey: "https://self-hosted.example",
    });

    expect(disabled.community).toBe("disabled");
    expect(disabled.entries.map((entry) => entry.id)).toEqual(["org.edgeever.tasks"]);
  });

  test("does not let an older signed file replace the cached catalog", async () => {
    const { raw, privateKey } = signingKey();
    const storage = createMemoryCommunityRegistryStorage();
    const newer = signedRelease(privateKey, registryDocument([communityEntry], { updatedAt: "2026-10-06T00:00:00.000Z" }));
    const older = signedRelease(
      privateKey,
      registryDocument([{ ...communityEntry, id: "com.example.other", name: "Other" }], { updatedAt: "2026-10-04T00:00:00.000Z" }),
    );
    await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => newer,
      storage,
      publicKeys: [raw],
      instanceKey: "https://official.example",
    });
    const result = await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => older,
      storage,
      publicKeys: [raw],
      instanceKey: "https://official.example",
    });

    expect(result.community).toBe("cached");
    expect(result.entries.map((entry) => entry.id)).toEqual(["org.edgeever.tasks", "com.example.readwise"]);
    expect((await storage.readRegistry("https://official.example"))?.updatedAt).toBe("2026-10-06T00:00:00.000Z");
  });

  test("remembers a revocation after a later signed file omits it", async () => {
    const { raw, privateKey } = signingKey();
    const storage = createMemoryCommunityRegistryStorage();
    const revoked = signedRelease(privateKey, registryDocument([], {
      revocations: [{ id: "com.example.readwise", reason: "仓库已转为私有", revokedAt: "2026-10-05T00:00:00.000Z" }],
    }));
    const first = await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => revoked,
      storage,
      publicKeys: [raw],
      instanceKey: "https://official.example",
    });
    const returned = signedRelease(privateKey, registryDocument([communityEntry], { updatedAt: "2026-10-07T00:00:00.000Z" }));
    const second = await loadDisplayPluginMarketplace({
      refreshCommunity: true,
      request: bundledRequest,
      fetchCommunityRegistry: async () => returned,
      storage,
      publicKeys: [raw],
      instanceKey: "https://official.example",
    });

    expect(first.revocations.map((item) => item.id)).toEqual(["com.example.readwise"]);
    expect(second.entries.map((entry) => entry.id)).toEqual(["org.edgeever.tasks"]);
    expect(second.revocations.map((item) => item.id)).toEqual(["com.example.readwise"]);
  });

  test("keeps startup official sync on the bundled registry", () => {
    const host = readFileSync(new URL("./plugin-host.ts", import.meta.url), "utf8");
    const workspace = readFileSync(new URL("../../components/WorkspaceApp.tsx", import.meta.url), "utf8");
    expect(host).toContain("loadPluginMarketplace");
    expect(host).not.toContain("loadResolvedPluginMarketplace");
    expect(host).not.toContain("loadDisplayPluginMarketplace");
    expect(host).not.toContain("getCommunityPluginRegistry");
    expect(workspace).toContain("loadResolvedPluginMarketplace");
    expect(workspace).not.toContain("loadDisplayPluginMarketplace");
    expect(workspace).not.toContain("getCommunityPluginRegistry");
  });
});

describe("community submission precheck", () => {
  test("opens an issue template with the repository and plugin id", () => {
    const url = new URL(communityPluginSubmissionIssueUrl("com.example.readwise", "https://github.com/example/readwise"));
    expect(url.origin + url.pathname).toBe("https://github.com/tianma-if/edgeever-plugins/issues/new");
    expect(url.searchParams.get("template")).toBe("plugin-submission.yml");
    expect(url.searchParams.get("plugin_id")).toBe("com.example.readwise");
    expect(url.searchParams.get("repository_url")).toBe("https://github.com/example/readwise");
    const source = readFileSync(new URL("./community-plugin-submission.ts", import.meta.url), "utf8");
    expect(source).toContain("downloadGithubExtension");
    expect(source).not.toContain("license");
    expect(source).not.toContain("/git/trees/");
  });
});
