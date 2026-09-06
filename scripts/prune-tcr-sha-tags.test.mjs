import { describe, expect, test } from "bun:test";
import {
  createTencentCloudRequest,
  selectTcrShaTagsToDelete,
} from "./prune-tcr-sha-tags.mjs";

describe("TCR sha tag retention", () => {
  test("keeps the newest sha tags without touching release tags", () => {
    const tags = [
      { TagName: "v1.40.0", PushTime: "2026-08-25 13:00:00 +0800 CST" },
      { TagName: "1.40.0", PushTime: "2026-08-25 13:00:00 +0800 CST" },
      { TagName: "latest", PushTime: "2026-08-25 13:00:00 +0800 CST" },
      {
        TagName: "sha-cccccccccccc",
        PushTime: "2026-08-25 12:00:00 +0800 CST",
      },
      {
        TagName: "sha-bbbbbbbbbbbb",
        PushTime: "2026-08-25 11:00:00 +0800 CST",
      },
      {
        TagName: "sha-aaaaaaaaaaaa",
        PushTime: "2026-08-25 10:00:00 +0800 CST",
      },
    ];

    expect(selectTcrShaTagsToDelete(tags, 2)).toEqual(["sha-aaaaaaaaaaaa"]);
  });

  test("uses creation time as a fallback and rejects invalid retention", () => {
    const tags = [
      {
        TagName: "sha-bbbbbbbbbbbb",
        CreationTime: "2026-08-25 12:00:00 +0800 CST",
      },
      {
        TagName: "sha-aaaaaaaaaaaa",
        CreationTime: "2026-08-24 12:00:00 +0800 CST",
      },
    ];

    expect(selectTcrShaTagsToDelete(tags, 1)).toEqual(["sha-aaaaaaaaaaaa"]);
    expect(() => selectTcrShaTagsToDelete(tags, 0)).toThrow("positive integer");
  });

  test("signs requests without exposing the secret key", () => {
    const request = createTencentCloudRequest({
      action: "DescribeImagePersonal",
      body: { RepoName: "edgeever/edgeever", Offset: 0, Limit: 100 },
      region: "ap-guangzhou",
      secretId: "example-secret-id",
      secretKey: "example-secret-key",
      timestamp: 1_788_000_000,
    });

    expect(request.headers.Authorization).toContain(
      "Credential=example-secret-id/",
    );
    expect(request.headers.Authorization).toContain(
      "SignedHeaders=content-type;host;x-tc-action",
    );
    expect(request.headers.Authorization).not.toContain("example-secret-key");
    expect(request.headers["X-TC-Action"]).toBe("DescribeImagePersonal");
    expect(request.headers["X-TC-Region"]).toBe("ap-guangzhou");
  });
});
