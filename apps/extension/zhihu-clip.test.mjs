import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  canonicalZhihuUrl,
  fetchZhihuItemInPage,
  questionIdFromHref,
  replaceZhihuImageUrls,
  resolveZhihuNote,
  saveCapturedZhihuNote,
  zhihuBodyFromHtml,
  zhihuNoteMarkdown,
  zhihuNoteTitle,
  zhihuTargetFromPageUrl,
  zhihuTimeIso,
} from "./src/zhihu-clip.ts";

const answerId = "2088594131882872928";
const questionId = "2032748057339635056";
const articleId = "2089046649519568283";
const answerUrl = `https://www.zhihu.com/question/${questionId}/answer/${answerId}`;
const articleUrl = `https://zhuanlan.zhihu.com/p/${articleId}`;
const imageUrl = "https://pic3.zhimg.com/v2-44e9d53e8322583db6a429f8014ea55a_r.jpg";

const html = [
  "<p>岸上没有人。<a class=\"RichContent-EntityWord css-1\" href=\"https://zhida.zhihu.com/search?q=1\">潜水员<svg viewBox=\"0 0 1 1\"></svg></a>听见叫声。</p>",
  `<figure><img src="https://pic3.zhimg.com/v2-44e9d53e8322583db6a429f8014ea55a_1440w.jpg" data-caption="岸边" data-original="${imageUrl}"/></figure>`,
  "<img src=\"https://picx.zhimg.com/v2-44e9d53e8322583db6a429f8014ea55a_b.jpg\"/>",
  "<img src=\"https://pic1.zhimg.com/avatar/cat.jpg\"/>",
].join("");

const labels = {
  capturedAt: "2026-10-01T00:00:00.000Z",
  sourceLabel: "来源",
  capturedAtLabel: "抓取时间",
  timeLabel: "时间",
  questionLabel: "问题",
  articleLabel: "文章",
  authorLabel: "作者：",
  answerLabel: "回答",
  articleBodyLabel: "正文",
};

const located = {
  ok: true,
  kind: "answer",
  id: answerId,
  questionId,
  title: "预览标题",
  author: "页面作者",
  href: answerUrl,
  pageUrl: "https://www.zhihu.com/",
  domHtml: "<p>折叠预览</p>",
  domComplete: false,
};

describe("zhihu addresses", () => {
  test("reads an answer or article from its page and ignores a feed or question list", () => {
    expect(zhihuTargetFromPageUrl(answerUrl)).toEqual({ kind: "answer", id: answerId, questionId });
    expect(zhihuTargetFromPageUrl(`https://zhihu.com/answer/${answerId}?utm=1`)).toEqual({
      kind: "answer",
      id: answerId,
      questionId: "",
    });
    expect(zhihuTargetFromPageUrl(`${articleUrl}?utm=1`)).toEqual({
      kind: "article",
      id: articleId,
      questionId: "",
    });
    expect(zhihuTargetFromPageUrl("https://www.zhihu.com/")).toBeNull();
    expect(zhihuTargetFromPageUrl(`https://www.zhihu.com/question/${questionId}`)).toBeNull();
    expect(zhihuTargetFromPageUrl("https://zhuanlan.zhihu.com/c_123")).toBeNull();
    expect(zhihuTargetFromPageUrl("https://x.com/home")).toBeNull();
    expect(questionIdFromHref(`//www.zhihu.com/question/${questionId}/answer/${answerId}`)).toBe(questionId);
    expect(canonicalZhihuUrl({ kind: "answer", id: answerId, questionId })).toBe(answerUrl);
    expect(canonicalZhihuUrl({ kind: "article", id: articleId, questionId: "" })).toBe(articleUrl);
    expect(canonicalZhihuUrl({ kind: "answer", id: "nope", questionId })).toBe("");
  });
});

describe("zhihu note content", () => {
  test("browser bundle converts HTML without a document in the background", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "edgeever-zhihu-worker-"));
    try {
      const result = await Bun.build({
        entrypoints: [fileURLToPath(new URL("./src/zhihu-clip.ts", import.meta.url))],
        target: "browser",
        format: "esm",
        outdir,
      });
      expect(result.success).toBe(true);
      expect(typeof document).toBe("undefined");
      const browserModule = await import(pathToFileURL(join(outdir, "zhihu-clip.js")).href);
      const body = browserModule.zhihuBodyFromHtml(html, "图片");
      expect(body.markdown).toContain("岸上没有人。潜水员听见叫声。");
      expect(body.markdown).toContain(`![岸边](${imageUrl})`);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });

  test("keeps the answer text, original photo, author, and canonical link", () => {
    expect(zhihuTimeIso(1790739645)).toBe("2026-09-30T03:40:45.000Z");
    const body = zhihuBodyFromHtml(html, "图片");
    expect(body.markdown).toContain("岸上没有人。潜水员听见叫声。");
    expect(body.markdown).not.toContain("zhida.zhihu.com");
    expect(body.markdown).not.toContain("<svg");
    expect(body.images.map((image) => image.url)).toEqual([imageUrl]);
    expect(body.images[0]?.alt).toBe("岸边");
    expect(body.markdown).toContain(`![岸边](${imageUrl})`);
    const resolved = resolveZhihuNote(located, {
      ok: true,
      kind: "answer",
      id: answerId,
      title: "谁叫我上来的？",
      author: "苏澄宇",
      html,
      questionId,
      timeSeconds: 1790739645,
      truncated: false,
    });
    expect(resolved?.noteUrl).toBe(answerUrl);
    expect(resolved?.author).toBe("苏澄宇");
    const markdown = zhihuNoteMarkdown({
      ...labels,
      kind: "answer",
      author: resolved.author,
      title: resolved.title,
      body: body.markdown,
      noteUrl: resolved.noteUrl,
      datetime: zhihuTimeIso(resolved.timeSeconds),
    });
    expect(markdown.startsWith("## 问题\n\n> 谁叫我上来的？\n\n**作者：** 苏澄宇\n\n## 回答\n\n岸上没有人。")).toBe(true);
    expect(markdown).toContain("\n\n---\n\n来源:");
    expect(markdown).toContain(`(${answerUrl})`);
    expect(markdown).toContain("时间: 2026-09-30T03:40:45.000Z");
    expect(replaceZhihuImageUrls(markdown, [{ url: imageUrl, resourceId: "res 1" }])).toContain(
      "![岸边](/api/v1/resources/res%201/blob)",
    );
    expect(replaceZhihuImageUrls(markdown, [{ url: imageUrl, resourceId: "res 1" }])).not.toContain("zhimg.com");
    expect(zhihuNoteTitle({ title: "", author: "苏澄宇", body: "岸上没有人。", fallback: "一篇知乎内容" }))
      .toBe("苏澄宇: 岸上没有人。");
  });

  test("labels article title, author, and body separately", () => {
    const markdown = zhihuNoteMarkdown({
      ...labels,
      kind: "article",
      title: "专栏标题",
      author: "页面作者",
      body: "专栏标题\n\n文章正文。",
      noteUrl: articleUrl,
      datetime: "",
    });
    expect(markdown).toStartWith("## 文章\n\n> 专栏标题\n\n**作者：** 页面作者\n\n## 正文\n\n文章正文。");
    expect(markdown).not.toContain("## 回答");
  });

  test("uses the open page when the api content is missing or shorter than a truncated copy", () => {
    expect(resolveZhihuNote({ ...located, domComplete: false, domHtml: "<p>只有预览</p>" }, {
      ok: false,
      reason: "unreadable",
    })).toBeNull();
    const fromPage = resolveZhihuNote({
      ...located,
      kind: "article",
      id: articleId,
      questionId: "",
      title: "专栏标题",
      author: "页面作者",
      domHtml: "<p>页面上的全文</p>",
      domComplete: true,
    }, { ok: false, reason: "unreadable" });
    expect(fromPage?.html).toBe("<p>页面上的全文</p>");
    expect(fromPage?.noteUrl).toBe(articleUrl);
    const longerPage = resolveZhihuNote({
      ...located,
      domHtml: "<p>展开后的更长正文</p>",
      domComplete: true,
    }, {
      ok: true,
      kind: "answer",
      id: answerId,
      title: "接口标题",
      author: "接口作者",
      html: "<p>短</p>",
      questionId,
      timeSeconds: 10,
      truncated: true,
    });
    expect(longerPage?.html).toBe("<p>展开后的更长正文</p>");
    expect(longerPage?.title).toBe("接口标题");
  });

  test("reads the zhihu api in the page world without extension helpers", () => {
    const source = fetchZhihuItemInPage.toString();
    expect(source).toContain("/api/v4/answers/");
    expect(source).toContain("https://zhuanlan.zhihu.com/api/articles/");
    expect(source).not.toContain("prepareZhihuHtml");
    expect(source).not.toContain("resolveZhihuNote");
    expect(source).not.toContain("zhihuTargetFromPageUrl");
  });

  test("keeps the address parsers identical in the page scripts", () => {
    const library = readFileSync(new URL("./src/zhihu-clip.ts", import.meta.url), "utf8");
    const parser = library.match(/const targetFromLocation = \(hostname: string, pathname: string\) => \{[\s\S]*?\n\};/);
    const question = library.match(/export const questionIdFromHref = \(href: string\) => \{[\s\S]*?\n\};/);
    const compact = (source) => source.replace(/^export /gm, "").replace(/^[ \t]+/gm, "");
    expect(parser?.[0]).toBeTruthy();
    expect(question?.[0]).toBeTruthy();
    for (const file of ["./src/capture-zhihu.ts", "./src/zhihu-target.ts"]) {
      const page = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(compact(page)).toContain(compact(parser[0]));
    }
    const capture = readFileSync(new URL("./src/capture-zhihu.ts", import.meta.url), "utf8");
    expect(compact(capture)).toContain(compact(question[0]));
    const background = readFileSync(new URL("./src/background.ts", import.meta.url), "utf8");
    const patterns = background.slice(
      background.indexOf("const ZHIHU_DOCUMENT_PATTERNS"),
      background.indexOf("const ZHIHU_DOCUMENT_PATTERNS") + 320,
    );
    const block = background.slice(background.indexOf("id: ZHIHU_MENU_ID"), background.indexOf("id: ZHIHU_MENU_ID") + 320);
    expect(patterns).toContain("https://www.zhihu.com/*");
    expect(patterns).toContain("https://zhuanlan.zhihu.com/*");
    expect(block).toContain('contexts: ["page", "video"]');
    expect(block).toContain("documentUrlPatterns: ZHIHU_DOCUMENT_PATTERNS");
    expect(block).not.toContain("selection");
    expect(block).not.toContain('"image"');
  });
});

describe("saveCapturedZhihuNote", () => {
  const client = () => {
    const calls = { created: null, saved: null };
    return {
      calls,
      api: {
        listNotebooks: async () => ({ notebooks: [{ id: "nb_first" }] }),
        createMemo: async (body) => {
          calls.created = body;
          return { memo: { id: "memo_1" } };
        },
        uploadImage: async () => ({ id: "res_1" }),
        createEditSession: async () => ({
          editSession: { id: "edit_1", baseRevision: 3, baseContentHash: "a".repeat(64) },
        }),
        saveMemo: async (_memoId, body) => {
          calls.saved = body;
          return {};
        },
        deleteMemo: async () => ({}),
        createWithImage: async () => ({ memoId: "memo_1", resourceId: "res_1" }),
      },
    };
  };

  test("creates the note with the remote photo, then rewrites a successful upload", async () => {
    const fixture = client();
    const saved = await saveCapturedZhihuNote(fixture.api, {
      kind: "answer",
      notebookId: "",
      title: "谁叫我上来的？",
      author: "苏澄宇",
      noteTitle: "谁叫我上来的？",
      body: `岸上没有人。\n\n![岸边](${imageUrl})`,
      noteUrl: answerUrl,
      datetime: "2026-09-30T03:40:45.000Z",
      images: [{
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/jpeg",
        filename: "shore.jpg",
        alt: "岸边",
        sourceUrl: imageUrl,
      }],
      ...labels,
    });
    expect(saved).toEqual({ memoId: "memo_1", resourceIds: ["res_1"] });
    expect(fixture.calls.created.notebookId).toBe("nb_first");
    expect(fixture.calls.created.tags).toEqual(["web-clip"]);
    expect(fixture.calls.created.contentMarkdown).toContain(imageUrl);
    expect(fixture.calls.created.contentMarkdown).toContain("## 回答\n\n岸上没有人。");
    expect(fixture.calls.saved.contentMarkdown).toContain("![岸边](/api/v1/resources/res_1/blob)");
    expect(fixture.calls.saved.contentMarkdown).not.toContain("zhimg.com");
    expect(fixture.calls.saved.expectedRevision).toBe(3);
  });
});
