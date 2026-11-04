import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";

// linkedom's window forwards writes to globalThis, so location and setTimeout set on it below must be restored too.
const GLOBAL_KEYS = ["window", "document", "fetch", "FileReader", "location", "setTimeout"];
const originalDescriptors = new Map(
  GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const linkedomWindow = parseHTML("<!DOCTYPE html><html><head></head><body></body></html>");
linkedomWindow.location = { href: "https://notes.example/app/memo/1" };
linkedomWindow.setTimeout = (callback) => {
  callback();
  return 0;
};
globalThis.window = linkedomWindow;
globalThis.document = linkedomWindow.document;

// Deterministic data URL encoder: "data:<type>;base64,<payload>".
class FakeFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      if (blob.type === "application/x-unreadable") {
        this.error = new Error("unreadable blob");
        this.onerror?.();
        return;
      }
      if (blob.type === "application/x-binary-result") {
        this.result = buffer;
        this.onload?.();
        return;
      }
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload?.();
    });
  }
}
globalThis.FileReader = FakeFileReader;

afterAll(() => {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

let fetchCalls = [];
const installFetch = (routes) => {
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    const route = routes[url];
    if (!route) throw new TypeError("network down");
    if (route.status && route.status !== 200) return new Response("missing", { status: route.status });
    return new Response(new Blob([route.body], { type: route.type }), { status: 200 });
  };
};

afterEach(() => {
  globalThis.fetch = originalDescriptors.get("fetch")?.value;
  document.body.innerHTML = "";
});

let mod;
beforeAll(async () => {
  mod = await import("./note-html-export.ts");
});

const createRoot = (html) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
};

describe("buildHtmlFilename", () => {
  test("replaces reserved filename characters and collapses whitespace", () => {
    expect(mod.buildHtmlFilename('a<b>c:d"e/f\\g|h?i*j', "Untitled")).toBe("a-b-c-d-e-f-g-h-i-j.html");
    expect(mod.buildHtmlFilename("Tab\tand\nnewline", "Untitled")).toBe("Tab-and-newline.html");
    expect(mod.buildHtmlFilename("  many    spaces  ", "Untitled")).toBe("many spaces.html");
  });

  test("strips trailing dots and spaces and falls back when nothing is left", () => {
    expect(mod.buildHtmlFilename("Report... ", "Untitled")).toBe("Report.html");
    expect(mod.buildHtmlFilename("...", "Untitled")).toBe("Untitled.html");
    expect(mod.buildHtmlFilename("", "Fallback")).toBe("Fallback.html");
  });

  test("prefixes Windows device names, including ones with extensions", () => {
    expect(mod.buildHtmlFilename("con", "Untitled")).toBe("_con.html");
    expect(mod.buildHtmlFilename("LPT1.txt", "Untitled")).toBe("_LPT1.txt.html");
    expect(mod.buildHtmlFilename("COM0", "Untitled")).toBe("COM0.html");
    expect(mod.buildHtmlFilename("console", "Untitled")).toBe("console.html");
  });

  test("keeps an existing html extension and normalizes .htm", () => {
    expect(mod.buildHtmlFilename("page.html", "Untitled")).toBe("page.html");
    expect(mod.buildHtmlFilename("page.HTML", "Untitled")).toBe("page.HTML");
    expect(mod.buildHtmlFilename("legacy.htm", "Untitled")).toBe("legacy.html");
  });

  test("truncates long titles to 100 characters before adding the extension", () => {
    const filename = mod.buildHtmlFilename("x".repeat(250), "Untitled");
    expect(filename).toBe(`${"x".repeat(100)}.html`);
  });
});

describe("escapeHtml", () => {
  test("escapes all markup-significant characters", () => {
    expect(mod.escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  test("escapes ampersands first so entities are not double-decoded", () => {
    expect(mod.escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });
});

describe("getHtmlImageEmbedNoticeKind", () => {
  test("classifies image embedding outcomes", () => {
    expect(mod.createEmptyHtmlImageEmbedResult()).toEqual({ total: 0, embedded: 0, failed: 0 });
    expect(mod.getHtmlImageEmbedNoticeKind({ total: 0, embedded: 0, failed: 0 })).toBe("none");
    expect(mod.getHtmlImageEmbedNoticeKind({ total: 3, embedded: 3, failed: 0 })).toBe("none");
    expect(mod.getHtmlImageEmbedNoticeKind({ total: 3, embedded: 1, failed: 2 })).toBe("partial");
    expect(mod.getHtmlImageEmbedNoticeKind({ total: 2, embedded: 0, failed: 2 })).toBe("failed-all");
  });
});

describe("buildNoteHtmlContentMarkup", () => {
  test("joins notebook, date and tags into one escaped metadata line", () => {
    const markup = mod.buildNoteHtmlContentMarkup({
      title: "Plan",
      notebook: "Work",
      tags: ["a", "b"],
      updatedAt: "2026-01-02",
      bodyHtml: "<p>Body</p>",
    });
    expect(markup).toContain('<div class="edgeever-html-meta">Work · 2026-01-02 · #a · #b</div>');
    expect(markup).toContain('<h1 class="edgeever-html-title">Plan</h1>');
    expect(markup).toContain("<p>Body</p>");
  });

  test("omits the metadata line when there is no metadata", () => {
    const markup = mod.buildNoteHtmlContentMarkup({ title: "Only title", bodyHtml: "" });
    expect(markup).not.toContain("edgeever-html-meta");
  });

  test("escapes user-controlled title and metadata so they cannot inject markup", () => {
    const markup = mod.buildNoteHtmlContentMarkup({
      title: "<script>alert(1)</script>",
      notebook: "<img src=x onerror=alert(2)>",
      tags: ['"><svg onload=alert(3)>'],
      updatedAt: "<b>now</b>",
      bodyHtml: "",
    });
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain("<b>");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).toContain("#&quot;&gt;&lt;svg onload=alert(3)&gt;");

    const parsed = createRoot(markup);
    expect(parsed.querySelectorAll("script, img, svg, b")).toHaveLength(0);
    expect(parsed.querySelector(".edgeever-html-title").textContent).toBe("<script>alert(1)</script>");
  });
});

describe("buildStandaloneHtmlDocument", () => {
  test("produces a complete document with defaults", () => {
    const html = mod.buildStandaloneHtmlDocument({ title: "Doc", bodyHtml: "<p>Hi</p>" });
    expect(html.startsWith("<!DOCTYPE html>\n<html lang=\"en\">")).toBe(true);
    expect(html).toContain('<meta charset="utf-8" />');
    expect(html).toContain('<meta name="generator" content="EdgeEver" />');
    expect(html).toContain("<title>Doc</title>");
    expect(html).toContain("<style>\n\n</style>");
    expect(html).toContain("<p>Hi</p>");
    expect(html.endsWith("</html>\n")).toBe(true);
  });

  test("escapes title and language attribute while keeping styles and body verbatim", () => {
    const html = mod.buildStandaloneHtmlDocument({
      title: "</title><script>alert(1)</script>",
      language: 'en" onload="alert(1)',
      notebook: "NB",
      tags: ["t"],
      updatedAt: "today",
      bodyHtml: "<p>body</p>",
      styles: "body { color: red; }",
    });
    expect(html).toContain('<html lang="en&quot; onload=&quot;alert(1)">');
    expect(html).toContain("<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("body { color: red; }");
    expect(html).toContain("NB · today · #t");

    const { document: exported } = parseHTML(html);
    expect(exported.documentElement.getAttribute("lang")).toBe('en" onload="alert(1)');
    expect(exported.documentElement.hasAttribute("onload")).toBe(false);
    expect(exported.querySelectorAll("script")).toHaveLength(0);
    expect(exported.querySelector("title").textContent).toBe("</title><script>alert(1)</script>");
  });
});

describe("createHtmlFile and downloadHtmlFile", () => {
  test("creates a UTF-8 html blob with a sanitized filename", async () => {
    const { blob, filename } = mod.createHtmlFile("<p>ü</p>", "a/b", "Untitled");
    expect(filename).toBe("a-b.html");
    expect(blob.type).toBe("text/html;charset=utf-8");
    expect(await blob.text()).toBe("<p>ü</p>");
  });

  test("clicks a hidden temporary link and revokes the object URL", async () => {
    const created = [];
    const revoked = [];
    URL.createObjectURL = (blob) => {
      created.push(blob);
      return "blob:https://notes.example/export-1";
    };
    URL.revokeObjectURL = (url) => revoked.push(url);

    const clicks = [];
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tag) => {
      const element = originalCreateElement(tag);
      if (tag === "a") {
        element.click = () => clicks.push({
          href: element.href,
          // linkedom percent-encodes the download attribute; browsers keep it verbatim.
          download: decodeURIComponent(element.download),
          hidden: element.hidden,
          attached: element.parentNode === document.body,
        });
      }
      return element;
    };

    try {
      const filename = mod.downloadHtmlFile("<html></html>", "My: note", "Untitled");
      expect(filename).toBe("My- note.html");
      expect(created).toHaveLength(1);
      expect(await created[0].text()).toBe("<html></html>");
      expect(clicks).toEqual([{
        href: "blob:https://notes.example/export-1",
        download: "My- note.html",
        hidden: true,
        attached: true,
      }]);
      expect(document.body.querySelector("a")).toBeNull();
      expect(revoked).toEqual(["blob:https://notes.example/export-1"]);
    } finally {
      delete document.createElement;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});

describe("embedImagesForHtmlExport", () => {
  test("keeps data URLs, inlines fetched images and resolves relative URLs against the page", async () => {
    installFetch({
      "https://notes.example/app/images/a.png": { body: "PNG", type: "image/png" },
      "https://cdn.example/b.gif": { body: "GIF", type: "image/gif" },
    });
    const root = createRoot([
      '<img src="data:image/png;base64,AAAA">',
      '<img src="../images/a.png">',
      '<img src="https://cdn.example/b.gif">',
      '<img src="   ">',
      "<img>",
    ].join(""));

    const result = await mod.embedImagesForHtmlExport(root);
    expect(result).toEqual({ total: 3, embedded: 3, failed: 0 });

    const sources = Array.from(root.querySelectorAll("img"), (img) => img.getAttribute("src"));
    expect(sources[0]).toBe("data:image/png;base64,AAAA");
    expect(sources[1]).toBe(`data:image/png;base64,${Buffer.from("PNG").toString("base64")}`);
    expect(sources[2]).toBe(`data:image/gif;base64,${Buffer.from("GIF").toString("base64")}`);

    const urls = fetchCalls.map((call) => call.url).sort();
    expect(urls).toEqual(["https://cdn.example/b.gif", "https://notes.example/app/images/a.png"]);
    for (const call of fetchCalls) expect(call.init).toEqual({ credentials: "include" });
  });

  test("fetches blob URLs without credentials", async () => {
    installFetch({ "blob:https://notes.example/123": { body: "IMG", type: "image/webp" } });
    const root = createRoot('<img src="blob:https://notes.example/123">');
    const result = await mod.embedImagesForHtmlExport(root);
    expect(result).toEqual({ total: 1, embedded: 1, failed: 0 });
    expect(fetchCalls).toEqual([{ url: "blob:https://notes.example/123", init: { credentials: "omit" } }]);
    expect(root.querySelector("img").getAttribute("src")).toStartWith("data:image/webp;base64,");
  });

  test("leaves the original link in place and counts failures for HTTP errors, network errors and unreadable blobs", async () => {
    installFetch({
      "https://cdn.example/missing.png": { status: 404 },
      "https://cdn.example/bad.bin": { body: "x", type: "application/x-unreadable" },
      "https://cdn.example/odd.bin": { body: "x", type: "application/x-binary-result" },
      "https://cdn.example/ok.png": { body: "OK", type: "image/png" },
    });
    const root = createRoot([
      '<img src="https://cdn.example/missing.png">',
      '<img src="https://offline.example/x.png">',
      '<img src="https://cdn.example/bad.bin">',
      '<img src="https://cdn.example/odd.bin">',
      '<img src="https://cdn.example/ok.png">',
    ].join(""));

    const result = await mod.embedImagesForHtmlExport(root);
    expect(result).toEqual({ total: 5, embedded: 1, failed: 4 });
    expect(mod.getHtmlImageEmbedNoticeKind(result)).toBe("partial");

    const sources = Array.from(root.querySelectorAll("img"), (img) => img.getAttribute("src"));
    expect(sources.slice(0, 4)).toEqual([
      "https://cdn.example/missing.png",
      "https://offline.example/x.png",
      "https://cdn.example/bad.bin",
      "https://cdn.example/odd.bin",
    ]);
    expect(sources[4]).toStartWith("data:image/png;base64,");
  });

  test("falls back to the raw src when the page URL cannot be resolved", async () => {
    const location = window.location;
    window.location = { href: "not a url" };
    installFetch({});
    try {
      const root = createRoot('<img src="relative.png">');
      const result = await mod.embedImagesForHtmlExport(root);
      expect(result).toEqual({ total: 1, embedded: 0, failed: 1 });
      expect(mod.getHtmlImageEmbedNoticeKind(result)).toBe("failed-all");
      expect(fetchCalls.map((call) => call.url)).toEqual(["relative.png"]);
    } finally {
      window.location = location;
    }
  });
});

describe("code block preparation", () => {
  test("highlights regular code blocks but leaves Mermaid sources alone", () => {
    const root = createRoot([
      '<pre><code class="language-javascript">const answer = 42;</code></pre>',
      '<pre><code class="language-mermaid">graph TD\n  A --> B</code></pre>',
    ].join(""));
    mod.highlightCodeBlocksForHtmlExport(root);

    const [js, mermaid] = root.querySelectorAll("pre > code");
    expect(js.classList.contains("hljs")).toBe(true);
    expect(js.querySelector(".hljs-keyword").textContent).toBe("const");
    expect(js.textContent).toBe("const answer = 42;");
    expect(mermaid.classList.contains("hljs")).toBe(false);
    expect(mermaid.innerHTML).not.toContain("<span");
  });

  test("keeps the code block when highlighting throws", () => {
    const root = createRoot('<pre><code class="language-javascript">x</code></pre>');
    const code = root.querySelector("code");
    Object.defineProperty(code, "innerHTML", {
      get: () => { throw new Error("broken node"); },
      configurable: true,
    });
    expect(() => mod.highlightCodeBlocksForHtmlExport(root)).not.toThrow();
    expect(root.querySelector("pre > code")).toBe(code);
  });

  test("replaces valid Mermaid blocks with an SVG figure and keeps invalid or empty ones as source", async () => {
    const root = createRoot([
      '<pre><code class="language-mermaid">graph TD\n  Start --> Finish</code></pre>',
      '<pre><code class="language-mermaid">%%% not a diagram ((</code></pre>',
      '<pre><code class="language-mermaid">   </code></pre>',
    ].join(""));

    // Official Mermaid measures SVG text in a real browser. Exercise the
    // export's replacement and fallback behavior in this DOM-only test.
    const sources = [];
    await mod.renderMermaidBlocksForHtmlExport(root, async (source) => {
      sources.push(source);
      if (source === "graph TD\n  Start --> Finish") {
        return "<svg><text>Start</text></svg>";
      }
      throw new Error("Invalid Mermaid diagram");
    });
    expect(sources).toEqual(["graph TD\n  Start --> Finish", "%%% not a diagram (("]);

    const figures = root.querySelectorAll("figure.edgeever-html-mermaid");
    expect(figures).toHaveLength(1);
    expect(figures[0].querySelector("svg")).not.toBeNull();
    expect(figures[0].innerHTML).toContain("Start");

    const remaining = Array.from(root.querySelectorAll("pre > code.language-mermaid"), (code) => code.textContent);
    expect(remaining).toEqual(["%%% not a diagram ((", "   "]);
  });
});

describe("prepareNoteBodyHtmlForExport and downloadNoteHtmlFile", () => {
  test("prepares body HTML with highlighted code and embedded images", async () => {
    installFetch({ "https://cdn.example/pic.png": { body: "P", type: "image/png" } });
    const prepared = await mod.prepareNoteBodyHtmlForExport(
      '<p>Hi</p><pre><code class="language-css">a { color: red; }</code></pre><img src="https://cdn.example/pic.png">',
    );
    expect(prepared.images).toEqual({ total: 1, embedded: 1, failed: 0 });
    expect(prepared.bodyHtml).toContain("<p>Hi</p>");
    expect(prepared.bodyHtml).toContain("hljs");
    expect(prepared.bodyHtml).toContain(`src="data:image/png;base64,${Buffer.from("P").toString("base64")}"`);
    expect(prepared.bodyHtml).not.toContain("https://cdn.example/pic.png");
  });

  test("downloads a standalone document and reports image results", async () => {
    installFetch({});
    const blobs = [];
    URL.createObjectURL = (blob) => {
      blobs.push(blob);
      return "blob:https://notes.example/export-2";
    };
    URL.revokeObjectURL = () => {};
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tag) => {
      const element = originalCreateElement(tag);
      if (tag === "a") element.click = () => {};
      return element;
    };

    try {
      const result = await mod.downloadNoteHtmlFile({
        title: "<Trip>",
        notebook: "Travel",
        tags: ["summer"],
        updatedAt: "2026-07-01",
        language: "pl",
        fallbackTitle: "Untitled",
        bodyHtml: '<p>Body</p><img src="https://offline.example/a.png">',
        styles: ".x{}",
      });
      expect(result).toEqual({
        filename: "-Trip-.html",
        images: { total: 1, embedded: 0, failed: 1 },
      });
      expect(blobs).toHaveLength(1);
      const html = await blobs[0].text();
      expect(html).toContain('<html lang="pl">');
      expect(html).toContain("<title>&lt;Trip&gt;</title>");
      expect(html).toContain("Travel · 2026-07-01 · #summer");
      expect(html).toContain(".x{}");
      expect(html).toContain('<img src="https://offline.example/a.png">');
    } finally {
      delete document.createElement;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  test("uses empty styles and the fallback title when none are given", async () => {
    installFetch({});
    const blobs = [];
    URL.createObjectURL = (blob) => {
      blobs.push(blob);
      return "blob:x";
    };
    URL.revokeObjectURL = () => {};
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tag) => {
      const element = originalCreateElement(tag);
      if (tag === "a") element.click = () => {};
      return element;
    };
    try {
      const result = await mod.downloadNoteHtmlFile({ title: "  ", fallbackTitle: "Untitled", bodyHtml: "<p>x</p>" });
      expect(result).toEqual({ filename: "Untitled.html", images: { total: 0, embedded: 0, failed: 0 } });
      expect(await blobs[0].text()).toContain("<style>\n\n</style>");
    } finally {
      delete document.createElement;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
