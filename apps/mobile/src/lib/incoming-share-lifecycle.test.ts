import { describe, expect, test } from "bun:test";
import { clearAndRefreshIncomingShare } from "./incoming-share-lifecycle";

describe("incoming share lifecycle", () => {
  test("resets the observed payload so the same share can be received again", async () => {
    const articleUrl = "https://mp.weixin.qq.com/s/repeated-article";
    let nativePayload: string | null = articleUrl;
    let observedPayload: string | null = articleUrl;
    const calls: string[] = [];

    await clearAndRefreshIncomingShare(
      () => {
        calls.push("clear");
        nativePayload = null;
      },
      async () => {
        calls.push("refresh");
        observedPayload = nativePayload;
      },
    );

    expect(calls).toEqual(["clear", "refresh"]);
    expect(observedPayload).toBeNull();

    nativePayload = articleUrl;
    if (nativePayload !== observedPayload) {
      observedPayload = nativePayload;
    }
    expect(observedPayload).toBe(articleUrl);
  });
});
