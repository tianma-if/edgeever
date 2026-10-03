import { describe, expect, test } from "bun:test";
import {
  redditCanonicalUrl, redditPostFromApi, redditPostFromDom,
  redditPostIdFromUrl, redditPostMarkdown, saveCapturedRedditPost,
} from "./src/reddit-clip.ts";

const postId = "1abcxyz";
const source = `https://www.reddit.com/r/AskReddit/comments/${postId}/`;
const photo = "https://i.redd.it/photo.jpg";
const listing = (data) => [{ data: { children: [{ kind: "t3", data: { id: postId, ...data } }] } }, { data: { children: [] } }];
const labels = {
  sourceLabel: "Source", capturedAtLabel: "Captured", timeLabel: "Time",
  authorLabel: "Author", communityLabel: "Community", linkLabel: "Linked page",
  capturedAt: "2026-10-03T00:00:00.000Z",
};

describe("Reddit post capture", () => {
  test("recognizes only Reddit post URLs and keeps one canonical link", () => {
    expect(redditPostIdFromUrl(`https://old.reddit.com/r/AskReddit/comments/${postId}/slug?utm=1`)).toBe(postId);
    expect(redditPostIdFromUrl("https://www.reddit.com/r/AskReddit/")).toBe("");
    expect(redditPostIdFromUrl(`https://example.com/comments/${postId}/`)).toBe("");
    expect(redditCanonicalUrl(postId, "r/AskReddit")).toBe(source);
  });

  test("reads full text, gallery images, author, community, and post time from post JSON", () => {
    const post = redditPostFromApi(listing({
      title: "How does this work?", author: "sample_user", subreddit: "AskReddit",
      selftext: "First paragraph.\n\nSecond paragraph.", created_utc: 1790985600,
      gallery_data: { items: [{ media_id: "one", caption: "A photo" }] },
      media_metadata: { one: { s: { u: "https://i.redd.it/photo.jpg?width=100&amp;format=pjpg" } } },
    }), postId);
    expect(post).toMatchObject({
      id: postId, url: source, author: "sample_user", subreddit: "r/AskReddit",
      body: "First paragraph.\n\nSecond paragraph.",
    });
    expect(post.images).toEqual([{ url: "https://i.redd.it/photo.jpg?width=100&format=pjpg", alt: "A photo" }]);
    expect(redditPostFromApi(listing({ title: "Wrong" }), "another")).toBeNull();
    const markdown = redditPostMarkdown(post, labels);
    expect(markdown).toContain("Community: r/AskReddit");
    expect(markdown).toContain("Author: u/sample_user");
    expect(markdown).toContain("First paragraph.\n\nSecond paragraph.");
    expect(markdown).toContain(`Source: [${source}](${source})`);
    expect(markdown).toContain("![A photo](https://i.redd.it/photo.jpg?width=100&format=pjpg)");
  });

  test("uses only the selected post DOM when Reddit JSON is unavailable", () => {
    const post = redditPostFromDom({
      id: postId, title: "Selected post", author: "u/author", subreddit: "r/test",
      body: "Only this post", externalUrl: "https://example.com/article", datetime: "2026-10-02",
      images: [{ url: photo, alt: "Photo" }, { url: "javascript:alert(1)", alt: "Bad" }],
    }, postId);
    expect(post).toMatchObject({ title: "Selected post", author: "author", url: "https://www.reddit.com/r/test/comments/1abcxyz/" });
    expect(post.images).toEqual([{ url: photo, alt: "Photo" }]);
    expect(redditPostFromDom({ id: "other", title: "Wrong post" }, postId)).toBeNull();
  });

  test("saves remote image links first and replaces them after an upload", async () => {
    const calls = [];
    const client = {
      listNotebooks: async () => ({ notebooks: [{ id: "nb" }] }),
      createMemo: async (body) => { calls.push(["create", body]); return { memo: { id: "memo" } }; },
      uploadImage: async () => ({ id: "res 1" }),
      createEditSession: async () => ({ editSession: { id: "edit", baseRevision: 1, baseContentHash: "hash" } }),
      saveMemo: async (_id, body) => { calls.push(["save", body]); },
    };
    const post = redditPostFromApi(listing({ title: "Picture", subreddit: "pics", url_overridden_by_dest: photo }), postId);
    await saveCapturedRedditPost(client, post, { ...labels, notebookId: "", images: [{ url: photo, bytes: new Uint8Array([1]), mimeType: "image/jpeg", filename: "photo.jpg", alt: "Photo" }] });
    expect(calls[0][1].contentMarkdown).toContain(photo);
    expect(calls[1][1].contentMarkdown).toContain("/api/v1/resources/res%201/blob");
    expect(calls[1][1].contentMarkdown).not.toContain(photo);
  });
});
