import { prepareJikeWebDetail } from "./jike-web-test-state.mjs";
import { clipDateTimeText } from "./src/clip-time.ts";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { bundleTestScripts } from "./bundle-test-scripts.mjs";
import { createDocument, createWindow } from "@mixmark-io/domino";
import { markdownToDoc } from "../../packages/shared/src/content.ts";

const [background, captureScript, pageCaptureScript] = bundleTestScripts(["background", "capture-platform", "capture"]);
const urls = {
  wechat: "https://mp.weixin.qq.com/s/TC-ONpL3PGklsD0yhtcuBQ",
  jike: "https://m.okjike.com/originalPosts/66ac89b0314f5cced41012d3",
  sspai: "https://sspai.com/post/92653",
  juejin: "https://juejin.cn/post/6972051526416072717",
  douban: "https://book.douban.com/review/16093028/",
  boss: "https://www.zhipin.com/job_detail/0d7e760b0a0e7c3a0nF939S0E1NU.html",
  xueqiu: "https://xueqiu.com/5636485254/253443400",
  "substack-note": "https://substack.com/@tedgioia/note/c-357811021",
  "hacker-news": "https://news.ycombinator.com/item?id=40380738",
  v2ex: "https://www.v2ex.com/t/1000000",
  xiaoyuzhou: "https://www.xiaoyuzhoufm.com/episode/62ad4ae5f9b62781ea058a02",
  facebook: "https://www.facebook.com/NASA/posts/pfbid0dPToN66CzcAHGMoaNe3jszH4FfBKvqkE5gogCNJkTxXDPsSGYrGvcVwsLgByyMQQl",
  instagram: "https://www.instagram.com/p/DeAYvsnn4la/",
  threads: "https://www.threads.com/@nasa/post/DZceA72Drjf",
  bluesky: "https://bsky.app/profile/bsky.app/post/3mhgg5ja5gc2w",
  linkedin: "https://www.linkedin.com/posts/friends-of-nasa_nasa-space-astronomy-activity-7497764718095323136-NRvr",

};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

// Execute the actual bundled background and injected script. Only browser APIs
// and the instance's HTTP boundary are mocked; extraction and saving are real.
const harness = (options = {}) => {
  const platform = options.platform || "hacker-news";
  const pageUrl = options.pageUrl || urls[platform];
  let currentUrl = pageUrl;
  const window = createWindow(readFileSync(new URL(`./fixtures/platforms/${options.fixture || (platform === "douban" ? "douban-book" : platform)}.html`, import.meta.url), "utf8"), pageUrl);
  Object.getPrototypeOf(window.document.getElementsByTagName('*'))[Symbol.iterator] ??= Array.prototype[Symbol.iterator];
  Object.defineProperty(Object.getPrototypeOf(window.document),'baseURI',{configurable:true,get(){return this.URL;}});
  window.DOMParser = class { parseFromString(value) { return createDocument(value); } };
  window.getSelection = () => null;
  options.prepare?.(window.document, window);
  if(options.detailLoad) {
    const append=window.document.body.appendChild.bind(window.document.body);
    Object.defineProperty(window.document.body,'appendChild',{value:node=>{
      const value=append(node);
      if(node.tagName==='IFRAME')queueMicrotask(()=>{
        Object.defineProperty(node,'contentDocument',{value:options.detailLoad(node)});node.onload();
      });
      return value;
    }});
  }
  const calls = { creates: [], uploads: [], saves: [], injections: [], feedback: [], requests: [], rejectedMessages: [], imageRules: [] };
  let doubanImageRule=false, sspaiImageRule=false;
  let onMessage, onClick, menuDone;
  const json = (value, status = 200) => Response.json(value, { status });
  const fetchMock = async (url, init) => {
    calls.requests.push(String(url));
    const path = new URL(url).pathname;
    if (String(url).startsWith("https://edgeever.test")) {
      if (path === "/api/v1/notebooks") {
        options.notebookRequested?.();
        if (options.notebookGate) await options.notebookGate;
        if (options.navigateDuringNotebookLookup) currentUrl = "https://www.v2ex.com/t/1000001";
        return json({ notebooks: [{ id: "nb_inbox", slug: "inbox" }] });
      }
      if (path === "/api/v1/memos") {
        calls.creates.push(JSON.parse(init.body));
        return json({ memo: { id: "memo_1", revision: 1, contentHash: "original" } }, 201);
      }
      if (path.endsWith("/resources")) {
        calls.uploads.push(init.body);
        return options.failUpload ? json({ error: { message: "upload failed" } }, 500) : json({ resource: { id: `res_${calls.uploads.length}` } });
      }
      if (path.endsWith("/edit-sessions")) return json({ editSession: { id: "session", baseRevision: options.editConflict ? 2 : 1, baseContentHash: options.editConflict ? "user-edited" : "original" } });
      if (path.endsWith("/save")) {
        if (options.failRewrite) return json({ error: { message: "conflict" } }, 409);
        calls.saves.push(JSON.parse(init.body)); return json({});
      }
      throw new Error(`Unexpected instance request: ${path}`);
    }
    return options.failDownload || (options.requireDoubanImageRule && !doubanImageRule) || (options.requireSspaiImageRule && !sspaiImageRule) ? new Response("Forbidden", { status: 403 }) : new Response(png, { headers: { "content-type": "image/png" } });
  };
  let pageContext, selectionContext, onInstalled;
  const chrome = {
    i18n: { getMessage: (key, substitution) => key === "saveFailedWithReason" ? `${key}: ${substitution}` : key },
    runtime: {
      id: "extension-under-test",
      getURL: path=>`chrome-extension://extension-under-test/${path.replace(/^\/+/, '')}`,
      onInstalled: { addListener(listener) { onInstalled = listener; } }, onMessage: { addListener(listener) { onMessage = listener; } },
      openOptionsPage: async () => {},
      sendMessage: async (message) => {
        if (options.spoofMessages && message.type === "pagePlatformRead") {
          for (const overrides of [{ tab: { id: 999 } }, { frameId: 3 }, { id: "other-extension" }]) {
            const fake = { ...message, result: { ok: true, clip: { ...message.result.clip, title: "Wrong sender" } } };
            onMessage(fake, { id: chrome.runtime.id, tab: { id: 7 }, frameId: 0, url: currentUrl, ...overrides }, () => {});
            calls.rejectedMessages.push(overrides);
          }
          onMessage({ ...message, requestId: "unrelated", result: { ok: false } }, { id: chrome.runtime.id, tab: { id: 7 }, frameId: 0, url: currentUrl }, () => {});
        }
        onMessage(message, { id: chrome.runtime.id, tab: { id: 7 }, frameId: 0, url: options.senderUrl || currentUrl }, () => {});
      },
    },
    storage: { local: { get: async () => ({ instanceUrl: "https://edgeever.test", token: "test-token", notebookId: "" }) } },
    permissions: { contains: async () => !options.denyInstance },
    declarativeNetRequest: { updateSessionRules:async update=>{
      calls.imageRules.push(update);
      if(options.denyImageRule) throw new Error('Rule registration failed');
      doubanImageRule=update.addRules.some(rule=>new RegExp(rule.condition.regexFilter).test('https://img2.doubanio.com/view/thing_review/l/public/p11097731.webp') && rule.action.requestHeaders.some(header=>header.header==='Referer' && header.value==='https://www.douban.com/'));
      sspaiImageRule=update.addRules.some(rule=>new RegExp(rule.condition.regexFilter).test('https://cdnfile.sspai.com/2024/09/30/fc33a7ce5eea69d99afdf6ebc5b7259e.jpg') && rule.action.requestHeaders.some(header=>header.header==='Referer' && header.value==='https://sspai.com/'));
    } },
    tabs: { query: async () => [options.activeTab?.() || { id: 7, url: currentUrl }], get: async (tabId) => ({ id: tabId, url: tabId === 8 ? options.selectionTabUrl?.() || options.selectionWindow.location.href : options.navigateAfterModeProbe ? "https://www.zhipin.com/" : currentUrl }) },
    windows: { onRemoved: { addListener() {} } },
    contextMenus: { onClicked: { addListener(listener) { onClick = listener; } } },
    scripting: { executeScript: async ({ func, args = [], files, target }) => {
      if (args.some(value => value === undefined)) throw new Error("scripting.executeScript args must be JSON serializable");
      calls.injections.push({ files, target });
      const scriptContext = target.tabId === 8 ? selectionContext : pageContext;
      if (options.denyScripting) throw new Error("Cannot access contents of the page. Missing host permission.");
      if (func) {
        if (args[0]?.action === "toast") { if(["savingPlatformClip","savingSelection"].includes(args[0].message)) await options.feedbackGate?.(args[0].message); calls.feedback.push(args[0]); if (calls.feedback.length > 1 || args[0].kind === "error") menuDone?.(args[0]); return []; }
        if (options.navigateBeforeSelectionCapture && args[0]?.mode === "selection") currentUrl = "https://example.test/new-page";
        scriptContext.__args = args;
        return [{ result: await runInContext(`(${func.toString()})(...__args)`, scriptContext) }];
      }
      if (files?.[0] === "assets/capture-platform.js") runInContext(captureScript, scriptContext);
      else if (files?.[0] === "assets/capture.js") {
        await options.captureGate?.(target.tabId);
        runInContext(pageCaptureScript, scriptContext);
      }
      else if (!["assets/capture-image.js", "assets/clip-feedback.js", "assets/region-clip.js"].includes(files?.[0])) throw new Error(`Unexpected generic fallback: ${files}`);

      return [];
    } },
    action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
  };
  pageContext = createContext({ window, document: window.document, location: { get href() { return currentUrl; } }, URL, chrome, MutationObserver: window.MutationObserver, setTimeout, clearTimeout, setInterval, clearInterval, fetch: fetchMock, AbortSignal, Blob, Uint8Array });
  if (options.selectionWindow) {
    const selectedWindow = options.selectionWindow;
    selectedWindow.DOMParser = class { parseFromString(value) { return createDocument(value); } };
    const selectedChrome = { ...chrome, runtime: { ...chrome.runtime, sendMessage: async (message) => {
      onMessage(message, { id: chrome.runtime.id, tab: { id: 8 }, frameId: 0, url: selectedWindow.location.href }, () => {});
    } } };
    selectionContext = createContext({ window: selectedWindow, document: selectedWindow.document, location: selectedWindow.location, URL, chrome: selectedChrome, setTimeout, clearTimeout, setInterval, clearInterval, fetch: fetchMock, AbortSignal, Blob, Uint8Array });
  }
  if (options.withoutDesktopApis) {
    delete chrome.contextMenus;
    delete chrome.windows;
  }
  runInContext(background, createContext({ chrome, fetch: fetchMock, URL, crypto, setTimeout:options.backgroundSetTimeout || setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal, AbortController, Blob, File, FormData, Uint8Array, ArrayBuffer, Response }));
  return {
    installed: () => onInstalled({ reason: "install" }),
    document: window.document,
    calls,
    toolbar: () => new Promise((resolve) => onMessage({ type: "captureCurrentPage" }, { id: chrome.runtime.id }, resolve)),
    mode: () => new Promise((resolve) => onMessage({ type: "getCurrentPageCaptureMode" }, { id: chrome.runtime.id }, resolve)),
    message: (message, sender = { id: chrome.runtime.id, tab: { id: 7 }, frameId: 0, url: pageUrl }) => new Promise(resolve => {
      if (!onMessage(message, sender, resolve)) resolve({ ignored: true });
    }),
    menu: () => new Promise((resolve) => { menuDone = resolve; onClick({ menuItemId: `save-${platform}`, pageUrl, frameId: 0 }, { id: 7, url: pageUrl }); }),
    selectionMenu: () => new Promise((resolve) => {
      menuDone = resolve;
      const selectedWindow = options.selectionWindow;
      const tabUrl=options.selectionTabUrl?.() || selectedWindow.location.href;
      onClick({ menuItemId: "save-selection", pageUrl: tabUrl, frameUrl: selectedWindow.location.href, frameId: options.selectionFrameId || 0, selectionText: selectedWindow.getSelection().toString() }, { id: 8, url: tabUrl, title: selectedWindow.document.title });
    }),
  };
};

test("starting the region picker only injects its explicit script and writes nothing", async () => {
  const h = harness();
  expect(await h.message({ type: "startRegionClip" })).toMatchObject({ ok: true });
  expect(h.calls.injections).toEqual([{ target: { tabId: 7, frameIds: [0] }, files: ["assets/region-clip.js"] }]);
  expect(h.calls.requests).toHaveLength(0);
  const denied = harness({ denyScripting: true });
  expect(await denied.message({ type: "startRegionClip" })).toMatchObject({ ok: false, message: "pageAccessDenied" });
  expect(denied.calls.requests).toHaveLength(0);
});

test("a selected region uses the memo and image-localization pipeline without whole-page capture", async () => {
  const h = harness();
  const page = { title: "Selected section", url: urls["hacker-news"], markdown: "## Chosen\n\nOnly this paragraph.\n\n![Selected](https://example.test/photo.png)", kind: "region" };
  expect(await h.message({ type: "saveRegionClip", page })).toMatchObject({ ok: true });
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.creates[0].notebookId).toBe("nb_inbox");
  expect(h.calls.creates[0].contentMarkdown).toContain("Only this paragraph.");
  expect(h.calls.uploads).toHaveLength(1);
  expect(h.calls.saves[0].contentMarkdown).toContain("/api/v1/resources/res_1/blob");
  expect(h.calls.injections.some(call => call.files?.includes("assets/capture.js"))).toBe(false);
});

for (const failure of ["wrong-frame", "no-tab", "wrong-extension", "changed-url", "empty", "not-region"]) test(`region ${failure} cannot create a note`, async () => {
  const h = harness();
  const page = { title: "Selected", url: urls["hacker-news"], markdown: "Chosen content", kind: "region" };
  const sender = { id: "extension-under-test", tab: { id: 7 }, frameId: 0, url: page.url };
  if (failure === "wrong-frame") sender.frameId = 1;
  if (failure === "no-tab") delete sender.tab;
  if (failure === "wrong-extension") sender.id = "another-extension";
  if (failure === "changed-url") page.url += "&different=1";
  if (failure === "empty") page.markdown = "   ";
  if (failure === "not-region") page.kind = "page";
  expect(await h.message({ type: "saveRegionClip", page }, sender)).toMatchObject({ ok: false });
  expect(h.calls.creates).toHaveLength(0);
});

test("Android without desktop menu/window APIs can initialize and save from the popup", async () => {
  const h = harness({ withoutDesktopApis: true });
  expect(() => h.installed()).not.toThrow();
  expect(await h.mode()).toEqual({ kind: "platform", platform: "Hacker News" });
  expect(await h.toolbar()).toMatchObject({ ok: true });
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.creates[0].contentMarkdown).toContain("news.ycombinator.com/item?id=40380738");
});

test("BOSS popup detects login preview through the serialized DOM probe without creating or expanding anything", async () => {
  const h = harness({ platform: "boss", prepare: (doc) => { doc.body.innerHTML = createWindow(readFileSync(new URL('./fixtures/platforms/boss-login-required.html', import.meta.url), 'utf8')).document.body.innerHTML; } });
  expect(await h.mode()).toMatchObject({ kind: "platform", platform: "platformBoss", access: "login-required" });
  expect(h.calls.requests).toHaveLength(0);
  expect(h.calls.creates).toHaveLength(0);
  expect(h.calls.injections).toHaveLength(1);
});

test("BOSS readable page retains the adapted badge; failed or stale probes are unknown", async () => {
  expect(await harness({ platform: "boss" }).mode()).toEqual({ kind: "platform", platform: "platformBoss" });
  for (const option of ["denyScripting", "navigateAfterModeProbe"]) expect(await harness({ platform: "boss", [option]: true }).mode()).toEqual({ kind: "unknown" });
});

test("BOSS login preview can still save an explicit text selection without capturing the incomplete job", async () => {
  const h = harness({ platform: "boss", prepare: (doc, window) => {
    doc.body.innerHTML = createWindow(readFileSync(new URL('./fixtures/platforms/boss-login-required.html', import.meta.url), 'utf8')).document.body.innerHTML;
    window.getSelection = () => ({ rangeCount: 1, toString: () => "Only selected job text", getRangeAt: () => ({ cloneContents: () => {
      const fragment = doc.createDocumentFragment(), p = doc.createElement("p"); p.textContent = "Only selected job text"; fragment.appendChild(p); return fragment;
    } }) });
  } });
  expect((await h.mode()).access).toBe('login-required');
  expect((await h.toolbar()).ok).toBe(true);
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.creates[0].tags).toEqual(['web-clip']);
  expect(h.calls.creates[0].contentMarkdown).toContain('Only selected job text');
  expect(h.calls.creates[0].contentMarkdown).not.toContain('登录查看完整内容');
});

for (const platform of Object.keys(urls)) {
  test(`${platform}: toolbar and dedicated menu save the same note through the real parser`, async () => {
    const toolbar = harness({ platform }); const menu = harness({ platform });
    expect((await toolbar.toolbar()).ok).toBe(true);
    await menu.menu();
    expect(toolbar.calls.creates).toHaveLength(1);
    expect(menu.calls.creates).toHaveLength(1);
    const normalize = (note) => ({ ...note, contentMarkdown: note.contentMarkdown.replace(/capturedAtLabel: [^\n]+/, "capturedAtLabel: <capture time>") });
    expect(normalize(menu.calls.creates[0])).toEqual(normalize(toolbar.calls.creates[0]));
    expect(toolbar.calls.creates[0].tags).toEqual(platform === "xueqiu" ? ["web-clip", "xueqiu", "投资", "SH600438", "SH601012", "SH688472"] : ["web-clip", platform]);
    expect(toolbar.calls.creates[0].notebookId).toBe("nb_inbox");
    expect(toolbar.calls.creates[0].contentMarkdown).toMatch(/capturedAtLabel: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/);
    if (platform === "v2ex") {
      expect(toolbar.calls.creates[0].contentMarkdown).toContain("platformPublishedAtLabel: " + clipDateTimeText("2023-12-13T13:25:31+08:00"));
      expect(toolbar.calls.creates[0].contentMarkdown).toContain(clipDateTimeText("2023-12-13T14:47:02+08:00"));
      expect(toolbar.calls.creates[0].contentMarkdown).toContain(clipDateTimeText("2023-12-14T15:00:40+08:00"));
    }
    expect(toolbar.calls.requests.some((url) => /\.(mp3|m4a|mp4)(\?|$)/.test(url))).toBe(false);
  });
}

for(const action of ['toolbar','menu']) test(`Douban ${action} keeps paragraphs and archives all images after installing its own request rule`,async()=>{
  const h=harness({platform:'douban',requireDoubanImageRule:true});
  const response=await h[action]();
  if(action === 'toolbar') expect(response.ok).toBe(true);
  else expect(response.kind).toBe('success');
  expect(h.calls.creates).toHaveLength(1);expect(h.calls.uploads).toHaveLength(6);expect(h.calls.saves).toHaveLength(1);
  expect(h.calls.imageRules).toHaveLength(1);
  const rule=h.calls.imageRules[0].addRules[0];
  expect(rule.condition.initiatorDomains).toEqual(['extension-under-test']);
  expect(rule.condition.resourceTypes).toEqual(['xmlhttprequest']);
  expect(rule.condition.requestMethods).toEqual(['get']);
  const match=new RegExp(rule.condition.regexFilter);
  expect(match.test('https://img2.doubanio.com/view/thing_review/l/public/p11097731.webp')).toBe(true);
  for(const url of ['https://img2.doubanio.com.evil.test/view/x','https://img2.doubanio.com/not-images','https://example.test/?url=https://img2.doubanio.com/view/x']) expect(match.test(url)).toBe(false);
  expect(rule.action.requestHeaders).toEqual([{header:'Referer',operation:'set',value:'https://www.douban.com/'}]);
  for(const memo of [h.calls.creates[0],h.calls.saves[0]]) {
    expect(memo.contentMarkdown).toContain('\n\n在路上，我遇到了瓦尔泽');
    expect(memo.contentMarkdown).toContain('\n\n有人说，他写的是西方的散文');
  }
  expect(h.calls.saves[0].contentMarkdown.match(/!\[[^\]]*\]\(\/api\/v1\/resources\/res_\d\/blob\)/g)).toHaveLength(6);
});

test('Douban rule failure preserves one note and reports incomplete archival',async()=>{
  const h=harness({platform:'douban',requireDoubanImageRule:true,denyImageRule:true});
  expect(await h.toolbar()).toEqual({ok:true,message:'platformImagesPartial'});
  expect(h.calls.creates).toHaveLength(1);expect(h.calls.uploads).toHaveLength(0);expect(h.calls.saves).toHaveLength(0);expect(h.calls.imageRules).toHaveLength(1);
});

for (const action of ['toolbar', 'menu']) test(`Sspai ${action} supplies its image source header before archiving`, async () => {
  const h = harness({ platform: 'sspai', requireSspaiImageRule: true });
  await h[action]();
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.uploads).toHaveLength(9);
  expect(h.calls.saves).toHaveLength(1);
  expect(h.calls.imageRules).toHaveLength(1);
  const rules = h.calls.imageRules[0].addRules;
  const rule = rules.find(rule => rule.id === 2);
  expect(new Set(rules.map(rule => rule.id)).size).toBe(rules.length);
  expect(h.calls.imageRules[0].removeRuleIds).toEqual(rules.map(rule => rule.id));
  expect(rule.condition.initiatorDomains).toEqual(['extension-under-test']);
  expect(rule.condition.resourceTypes).toEqual(['xmlhttprequest']);
  expect(rule.condition.requestMethods).toEqual(['get']);
  expect(rule.action.requestHeaders).toEqual([{ header: 'Referer', operation: 'set', value: 'https://sspai.com/' }]);
  const match = new RegExp(rule.condition.regexFilter);
  expect(match.test('https://cdnfile.sspai.com/2024/09/30/photo.jpg?imageView2/2/format/webp')).toBe(true);
  for (const url of ['http://cdnfile.sspai.com/photo.jpg', 'https://cdnfile.sspai.com.evil.test/photo.jpg', 'https://example.test/?url=https://cdnfile.sspai.com/photo.jpg']) expect(match.test(url)).toBe(false);
  expect(h.calls.saves[0].contentMarkdown.match(/\/api\/v1\/resources\/res_\d+\/blob/g)).toHaveLength(9);
});

for(const action of ['toolbar','menu']) test(`Juejin ${action} saves the complete comparison table alongside archived article images`,async()=>{
  const h=harness({platform:'juejin'});await h[action]();
  expect(h.calls.creates).toHaveLength(1);expect(h.calls.uploads).toHaveLength(2);expect(h.calls.saves).toHaveLength(1);
  const text=node=>node.text || (node.content || []).map(text).join('');
  const expected=Array.from(h.document.querySelector('table').rows).map(row=>Array.from(row.cells).map(cell=>cell.textContent.trim()));
  for(const memo of [h.calls.creates[0],h.calls.saves[0]]) {
    const table=markdownToDoc(memo.contentMarkdown).content.find(node=>node.type==='table');
    expect(table?.content.map(row=>row.content.map(text))).toEqual(expected);
    expect(memo.contentMarkdown).not.toContain('复制代码');
  }
  expect(h.calls.saves[0].contentMarkdown).toContain('/api/v1/resources/res_2/blob');
});

for(const action of ['toolbar','menu']) test(`Sspai ${action} retains article updates and archives their images without changing publication time`,async()=>{
  const h=harness({platform:'sspai',prepare:doc=>doc.querySelector('.update-body').insertAdjacentHTML('beforeend','<p><img data-src="https://images.test/update.png"></p>')});
  await h[action]();expect(h.calls.creates).toHaveLength(1);
  const memo=h.calls.creates[0];expect(memo.tags).toEqual(['web-clip','sspai']);
  expect(memo.contentMarkdown).toContain('> **中国大陆推出睡眠呼吸暂停迹象提示功能**');
  expect(memo.contentMarkdown).toContain('> 2026 年 10 月 14 日，Apple 在中国大陆正式推出');
  expect(memo.contentMarkdown).toContain('> 以下内容于 10:00更新');
  expect(memo.contentMarkdown).toContain('platformPublishedAtLabel: 2024-10-10');
  expect(memo.contentMarkdown.match(/中国大陆推出睡眠呼吸暂停迹象提示功能/g)).toHaveLength(1);
  expect(h.calls.uploads).toHaveLength(10);
  expect(h.calls.saves[0].contentMarkdown).toContain('> **中国大陆推出睡眠呼吸暂停迹象提示功能**');
  expect(h.calls.saves[0].contentMarkdown).toContain('> ![](/api/v1/resources/res_10/blob)');
});

for(const action of ['toolbar','menu']) test(`WeChat ${action} cleans publisher promotions before archiving body images`,async()=>{
  const h=harness({platform:'wechat'});await h[action]();
  expect(h.calls.creates).toHaveLength(1);const memo=h.calls.creates[0];
  expect(memo.tags).toEqual(['web-clip','wechat']);expect(memo.contentMarkdown).toContain('大数据架构之道');
  expect(memo.contentMarkdown).toContain('选择模型进行对话');expect(memo.contentMarkdown.match(/!\[/g)).toHaveLength(21);
  expect(memo.contentMarkdown).toContain('## 什么是Deepseek V3');
  expect(memo.contentMarkdown).toMatch(/^###\s+第一步：注册华为云账号$/m);
  expect(h.calls.saves[0].contentMarkdown).toContain('## 什么是Deepseek V3');
  for(const noise of ['点击上方蓝字','分割线','现阶段的AI没有推理能力','DRPKCGMAPjK','iaic5Jv7oDhWHr79']) expect(memo.contentMarkdown).not.toContain(noise);
  expect(h.calls.uploads).toHaveLength(21);
  expect(h.calls.saves[0].contentMarkdown.match(/\/api\/v1\/resources\/res_\d+\/blob/g)).toHaveLength(21);
});

test("a new platform toolbar still saves a valid selection instead of its full article", async () => {
  const h = harness({ platform: "v2ex", prepare: (doc, window) => {
    window.getSelection = () => ({ rangeCount: 1, toString: () => "Only this passage", getRangeAt: () => ({ cloneContents: () => {
      const fragment = doc.createDocumentFragment(); const p = doc.createElement("p"); p.textContent = "Only this passage"; fragment.appendChild(p); return fragment;
    } }) });
  } });
  expect((await h.toolbar()).ok).toBe(true);
  expect(h.calls.creates[0].tags).toEqual(["web-clip"]);
  expect(h.calls.creates[0].contentMarkdown).toContain("Only this passage");
  expect(h.calls.creates[0].contentMarkdown).not.toContain("环境不好");
});

for(const [fixture,imageCount] of [["wechat-pictures",5],["wechat-pictures-ten",10],["wechat-pictures-no-heading",6]]) {
  for(const entry of ["toolbar","menu"]) test(`WeChat ${fixture} ${entry} saves every original picture through the existing attachment pipeline`,async()=>{
    const doc=createDocument(readFileSync(new URL(`./fixtures/platforms/${fixture}.html`,import.meta.url),'utf8'));
    const pageUrl=doc.querySelector('meta[property="og:url"]').getAttribute('content');
    const declared=JSON.parse(doc.querySelector('#wechat-picture-state').textContent);
    const h=harness({platform:'wechat',fixture,pageUrl,prepare:(_doc,window)=>{window.cgiDataNew=declared;}});
    const result=await h[entry]();expect(entry==='toolbar' ? result.ok : result.kind).toBe(entry==='toolbar' ? true : 'success');
    expect(h.calls.creates).toHaveLength(1);expect(h.calls.creates[0].title).toBe(doc.querySelector('.rich_media_title')?.textContent || doc.querySelector('meta[property="og:title"]').getAttribute('content'));
    expect(h.calls.creates[0].tags).toEqual(['web-clip','wechat']);
    expect(h.calls.uploads).toHaveLength(imageCount);expect(h.calls.saves).toHaveLength(1);
    const markdown=h.calls.saves[0].contentMarkdown;
    expect([...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m=>m[1])).toEqual(Array.from({length:imageCount},(_,i)=>`/api/v1/resources/res_${i+1}/blob`));
    expect(markdown).not.toContain('收录于推荐合集');expect(markdown).not.toContain('account-avatar.png');
  });
}

test("WeChat reads the full declared gallery rather than the site's twenty-picture preview",async()=>{
  const h=harness({platform:'wechat',fixture:'wechat-pictures',pageUrl:'https://mp.weixin.qq.com/s/FXFDv4PbDrq3ueGLVWU0-A',prepare:(doc,window)=>{
    const data=JSON.parse(doc.querySelector('#wechat-picture-state').textContent);
    data.picture_page_info_list=Array.from({length:21},(_,i)=>({cdn_url:`https://example.test/gallery/${i}.png`}));
    window.cgiDataNew=data;window.picture_page_info_list=data.picture_page_info_list.slice(0,20);
  }});
  expect((await h.toolbar()).ok).toBe(true);expect(h.calls.uploads).toHaveLength(21);
});

test("WeChat malformed picture state fails before creating a note",async()=>{
  for(const data of [undefined,{picture_page_info_list:[]},{link:urls.wechat,picture_page_info_list:[{cdn_url:'https://example.test/first.png'},{}]}]) {
    const h=harness({platform:'wechat',fixture:'wechat-pictures',pageUrl:'https://mp.weixin.qq.com/s/FXFDv4PbDrq3ueGLVWU0-A',prepare:(_doc,window)=>{window.cgiDataNew=data;}});
    expect((await h.toolbar()).ok).toBe(false);expect(h.calls.creates).toHaveLength(0);expect(h.calls.uploads).toHaveLength(0);
  }
});

test("WeChat conflicting declared aliases fail before saving, while matching aliases still archive the gallery",async()=>{
  const pageUrl='https://mp.weixin.qq.com/s?__biz=MzA%3D%3D&mid=123&idx=1&sn=abc';
  for(const conflict of [false,true]) {
    const h=harness({platform:'wechat',fixture:'wechat-pictures',pageUrl,prepare:(doc,window)=>{
      const data=JSON.parse(doc.querySelector('#wechat-picture-state').textContent);
      if(conflict)data.link=urls.wechat;window.cgiDataNew=data;
    }});
    const result=await h.toolbar();expect(result.ok).toBe(!conflict);
    expect(h.calls.creates).toHaveLength(conflict ? 0 : 1);expect(h.calls.uploads).toHaveLength(conflict ? 0 : 5);
    if(conflict)expect(result.message).toBe('platformPageChanged');
  }
});

test("Xiaoyuzhou saves the current client route using MAIN-world props while bootstrap JSON stays old", async () => {
  const id = "6a8ef24e1352af56ff3c83f3";
  const pageUrl = `https://www.xiaoyuzhoufm.com/episode/${id}`;
  const h = harness({ platform: "xiaoyuzhou", pageUrl, prepare: (doc, window) => {
    const episode = { eid: id, title: "Current route episode", shownotes: "<p>New route's complete notes</p>" };
    doc.querySelector("h1").textContent = episode.title;
    doc.querySelector(".sn-content article").innerHTML = episode.shownotes;
    doc.querySelector('link[rel="canonical"]').setAttribute("href", pageUrl);
    window.next = { router: { pathname: "/episode/[id]", query: { id }, components: { "/episode/[id]": { props: { pageProps: { episode } } } } } };
  } });
  expect((await h.toolbar()).ok).toBe(true);
  expect(h.calls.creates[0].title).toBe("Current route episode");
  expect(h.calls.creates[0].contentMarkdown).toContain("New route's complete notes");
  expect(h.calls.creates[0].contentMarkdown).not.toContain("韦礼安");
});

test("request, extension, tab and frame correlation reject unrelated responses", async () => {
  const h = harness({ spoofMessages: true });
  expect((await h.toolbar()).ok).toBe(true);
  expect(h.calls.rejectedMessages).toHaveLength(3);
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.creates[0].title).toStartWith("Show HN");
});

for (const failure of ["failDownload", "failUpload", "failRewrite", "editConflict"]) {
  test(`${failure}: keeps the saved body, reports external images, and never creates twice`, async () => {
    const h = harness({ platform: "xiaoyuzhou", [failure]: true });
    expect(await h.toolbar()).toEqual({ ok: true, message: "platformImagesPartial" });
    expect(h.calls.creates).toHaveLength(1);
    expect(h.calls.saves).toHaveLength(0);
    expect(h.calls.creates[0].contentMarkdown).toContain("xyzcdn.net");
  });
}

test("images beyond the limit count towards partial status after 30 successful uploads", async () => {
  const h = harness({ platform: "v2ex", prepare: (doc) => {
    const body = doc.querySelector(".topic_content");
    body.innerHTML += Array.from({ length: 32 }, (_, i) => `<img src="https://images.test/${i}.png">`).join("");
  } });
  expect(await h.toolbar()).toEqual({ ok: true, message: "platformImagesPartial" });
  expect(h.calls.uploads).toHaveLength(30);
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.saves[0].contentMarkdown).toContain("/api/v1/resources/res_1/blob");
  expect(h.calls.saves[0].contentMarkdown).toContain("https://images.test/31.png");
});

test("no Show Notes is a successful, explicitly qualified note", async () => {
  const h = harness({ platform: "xiaoyuzhou", prepare: (doc) => {
    doc.querySelector(".sn-content article").innerHTML = "";
    const state = doc.querySelector("#__NEXT_DATA__"); const data = JSON.parse(state.textContent);
    data.props.pageProps.episode.shownotes = ""; state.textContent = JSON.stringify(data);
  } });
  expect(await h.toolbar()).toEqual({ ok: true, message: "platformSavedWithImages platformNoShowNotes" });
  expect(h.calls.creates[0].contentMarkdown).toContain("platformNoShowNotes");
});

for (const platform of Object.keys(urls)) {
  test(`${platform}: unreadable content never falls back to a whole-page note`, async () => {
    const h = harness({ platform, prepare: (doc) => { doc.body.innerHTML = "<h1>Sign in</h1><p>Comments and recommendations</p>"; } });
    expect(await h.toolbar()).toEqual({ ok: false, message: "platformUnreadable" });
    expect(h.calls.creates).toHaveLength(0);
  });
}

test("navigation while resolving the notebook cancels the old content before creation", async () => {
  const h = harness({ platform: "v2ex", navigateDuringNotebookLookup: true });
  expect(await h.toolbar()).toEqual({ ok: false, message: "platformPageChanged" });
  expect(h.calls.creates).toHaveLength(0);
});

for (const [option, message] of [["denyInstance", "instancePermissionRequired"], ["denyScripting", "pageAccessDenied"]]) {
  test(`${option}: gives an actionable permission error without creating a note`, async () => {
    const h = harness({ [option]: true });
    expect(await h.toolbar()).toEqual({ ok: false, message });
    expect(h.calls.creates).toHaveLength(0);
  });
}


for (const navigate of [false, true]) test(`a stale sender URL after SPA navigation ${navigate ? "still cancels real navigation" : "does not reject the current post"}`, async () => {
  const h = harness({ platform: "linkedin", senderUrl: "https://www.linkedin.com/posts/previous-activity-123-test", navigateDuringNotebookLookup: navigate });
  const result = await h.toolbar();
  expect(result.ok).toBe(!navigate);
  expect(h.calls.creates).toHaveLength(navigate ? 0 : 1);
  if (navigate) expect(result.message).toBe("platformPageChanged");
  else expect(h.calls.creates[0].contentMarkdown).toContain("https://www.linkedin.com/feed/update/urn:li:activity:7497764718095323136/");
});

test("a pending saving toast cannot replace the already clicked post with a later right-click",async()=>{
 let release,started;const gate=new Promise(resolve=>release=resolve),shown=new Promise(resolve=>started=resolve);
 const h=harness({platform:'bluesky',fixture:'bluesky-feed',pageUrl:'https://bsky.app/profile/bsky.app',feedbackGate:()=>{started();return gate;}});
 const cards=Array.from(h.document.querySelectorAll('[data-testid^="feedItem-by-"]'));
 const urls=cards.slice(0,2).map(card=>Array.from(card.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')).find(href=>/^\/profile\/[^/]+\/post\/[^/]+$/.test(href))).map(path=>'https://bsky.app'+path);
 cards[0].setAttribute('data-edgeever-social-target',urls[0]);const pending=h.menu();await shown;
 cards[0].removeAttribute('data-edgeever-social-target');cards[1].setAttribute('data-edgeever-social-target',urls[1]);release();
 await pending;expect(h.calls.creates).toHaveLength(1);expect(h.calls.creates[0].contentMarkdown).toContain(urls[0]);expect(h.calls.creates[0].contentMarkdown).not.toContain(urls[1]);
});

test("queued social menu clips freeze each clicked post before a later right-click", async()=>{
 let release,started;const notebookGate=new Promise(r=>release=r),notebookStarted=new Promise(r=>started=r);
 const h=harness({platform:"bluesky",pageUrl:"https://bsky.app/profile/bsky.app",notebookGate,notebookRequested:started,prepare:doc=>{doc.body.replaceWith(createWindow(readFileSync(new URL('./fixtures/platforms/bluesky-feed.html',import.meta.url),'utf8')).document.body);}});
 const cards=Array.from(h.document.querySelectorAll('[data-testid^="feedItem-by-"]'));
 const urls=cards.slice(0,3).map(card=>Array.from(card.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')).find(href=>/^\/profile\/[^/]+\/post\/[^/]+$/.test(href))).map(path=>'https://bsky.app'+path);
 expect(urls).toHaveLength(3);
 cards[0].setAttribute('data-edgeever-social-target',urls[0]);const first=h.menu();await notebookStarted;
 cards[0].removeAttribute('data-edgeever-social-target');cards[1].setAttribute('data-edgeever-social-target',urls[1]);const second=h.menu();
 await new Promise(r=>setTimeout(r,0));cards[1].removeAttribute('data-edgeever-social-target');cards[2].setAttribute('data-edgeever-social-target',urls[2]);release();
 for(let n=0;n<200 && h.calls.creates.length<2;n++) await new Promise(r=>setTimeout(r,5));
 expect(h.calls.creates).toHaveLength(2);expect(h.calls.creates[0].contentMarkdown).toContain(urls[0]);expect(h.calls.creates[1].contentMarkdown).toContain(urls[1]);
 await Promise.race([Promise.all([first,second]),new Promise(r=>setTimeout(r,50))]);
});

for(const action of ['toolbar','menu']) test(`Bluesky ${action} saves rendered link destinations without hidden text`,async()=>{
 const h=harness({platform:'bluesky',prepare:doc=>{
  doc.querySelector('[data-word-wrap="1"]').innerHTML='<span hidden>HIDDEN TITLE SECRET</span>Read <a href="https://example.test/complete-article?id=123">example.test/complete...</a><span aria-hidden="true">HIDDEN BODY SECRET</span>';
 }});
 const response=await h[action]();if(action==='toolbar')expect(response.ok).toBe(true);
 expect(h.calls.creates).toHaveLength(1);
 const memo=h.calls.creates[0];
 expect(memo.title).toBe('Read example.test/complete...');
 expect(memo.contentMarkdown).toContain('[example.test/complete...](https://example.test/complete-article?id=123)');
 expect(memo.contentMarkdown).not.toContain('SECRET');
});


for(const [platform,pageUrl,selector] of [
 ['medium-article','https://scottbatson.dev/example','article'],
 ['substack-article','https://www.oneusefulthing.org/p/the-dot-and-the-swarm','.body.markup'],
]) test(`${platform}: unreadable rendered article returns an error without creating a fallback note`,async()=>{
 const h=harness({platform,pageUrl,prepare:doc=>doc.querySelector(selector).setAttribute('hidden','')});
 const response=await h.toolbar();expect(response.ok).toBe(false);expect(response.message).toContain('platformUnreadable');expect(h.calls.creates).toHaveLength(0);expect(h.calls.uploads).toHaveLength(0);
});


test("Douban list menu saves only the selected own short comment", async () => {
  const h=harness({platform:"douban",fixture:"douban-comments",pageUrl:"https://book.douban.com/subject/36864764/comments/",prepare:(doc)=>{
    doc.querySelector('.comment-item').setAttribute('data-edgeever-social-target','https://book.douban.com/comment/4237804504/');
  }});
  expect(await h.mode()).toEqual({kind:"social-feed"});
  await h.menu();
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.creates[0].title).toBe("散步 · 就绪雀");
  expect(h.calls.creates[0].contentMarkdown).toContain("有很多没必要写的句子");
  expect(h.calls.creates[0].contentMarkdown).not.toContain("翻译的存在感太明显了");
  expect(h.calls.creates[0].tags).toEqual(["web-clip","douban"]);
});


test("Jike Web detail login redirects show access guidance and never save the QR page as a post",async()=>{
  const h=harness({platform:'jike',pageUrl:'https://web.okjike.com/login?redirectURL=%2ForiginalPost%2F66ac89b0314f5cced41012d3',prepare:doc=>{doc.body.innerHTML='<p>可使用即刻App扫码</p>';}});
  expect(await h.mode()).toEqual({kind:'login-required',platform:'platformJike',access:'login-required'});
  expect(await h.toolbar()).toEqual({ok:false,message:'platformUnreadable'});
  expect(h.calls.creates).toHaveLength(0);
});

for (const [platform, pageUrl, fixture, emptyMessage] of [
  ['jike', 'https://web.okjike.com/login?redirectURL=%2ForiginalPost%2F66ac89b0314f5cced41012d3', 'jike', 'platformUnreadable'],
  ['douban', 'https://book.douban.com/subject/36864764/comments/', 'douban-comments', 'doubanSelectComment'],
]) {
  test(`${platform}: no clicked selection still rejects the restricted whole page`,async()=>{
    const h=harness({platform,pageUrl,fixture});
    expect(await h.toolbar()).toEqual({ok:false,message:emptyMessage});expect(h.calls.creates).toHaveLength(0);
  });

  test(`${platform}: a lost selection retains the clicked text without saving the restricted whole page`, async () => {
    const h = harness({platform, pageUrl, fixture, prepare: (doc, window) => {
      let reads = 0;
      window.getSelection = () => ++reads === 1 ? {toString: () => 'Selected passage'} : null;
    }});
    expect(await h.toolbar()).toMatchObject({ok:true});
    expect(h.calls.creates).toHaveLength(1);
    expect(h.calls.creates[0].contentMarkdown).toContain('Selected passage');
    expect(h.calls.creates[0].contentMarkdown).not.toContain('有很多没必要写的句子');
    expect(h.calls.creates[0].contentMarkdown).not.toContain('AI分析');
  });

  test(`${platform}: a stable selection saves only the selected passage`, async () => {
    const h = harness({platform, pageUrl, fixture, prepare: (doc, window) => {
      window.getSelection = () => ({rangeCount:1, toString: () => 'Selected passage', getRangeAt: () => ({cloneContents: () => {
        const fragment = doc.createDocumentFragment(), p = doc.createElement('p');
        p.textContent = 'Selected passage'; fragment.appendChild(p); return fragment;
      }})});
    }});
    expect(await h.toolbar()).toMatchObject({ok:true});
    expect(h.calls.creates).toHaveLength(1);
    expect(h.calls.creates[0].contentMarkdown).toContain('Selected passage');
    expect(h.calls.creates[0].contentMarkdown).not.toContain('有很多没必要写的句子');
    expect(h.calls.creates[0].contentMarkdown).not.toContain('AI分析');
  });

  for (const navigation of ["navigateBeforeSelectionCapture", "navigateDuringNotebookLookup"]) {
    test(`${platform}: ${navigation} refuses a stale selection before note creation`, async () => {
      const h = harness({platform, pageUrl, fixture, [navigation]:true, prepare: (doc, window) => {
        window.getSelection = () => ({rangeCount:1, toString: () => 'Selected passage', getRangeAt: () => ({cloneContents: () => {
          const fragment = doc.createDocumentFragment(), p = doc.createElement('p');
          p.textContent = 'Selected passage'; fragment.appendChild(p); return fragment;
        }})});
      }});
      expect(await h.toolbar()).toEqual({ok:false, message:"platformPageChanged"});
      expect(h.calls.creates).toHaveLength(0);
    });
  }
}

for (const secondCapture of ["selection-menu", "generic-toolbar"]) test(`restricted toolbar and another tab's ${secondCapture} never exchange capture replies`, async () => {
  const select = (doc, text) => ({rangeCount:1, toString: () => text, getRangeAt: () => ({cloneContents: () => {
    const fragment = doc.createDocumentFragment(), p = doc.createElement('p');
    p.textContent = text; fragment.appendChild(p); return fragment;
  }})});
  const selectionWindow = createWindow('<title>Page B</title><main><p>Selected B</p></main>', 'https://example.test/selected-b');
  selectionWindow.getSelection = () => secondCapture === "selection-menu" ? select(selectionWindow.document, 'Selected B') : null;
  const pageUrl = 'https://book.douban.com/subject/36864764/comments/';
  let activeTab = {id:7, url:pageUrl};
  let releaseA, releaseB, startedA, startedB;
  const gateA = new Promise(resolve => {releaseA = resolve;});
  const gateB = new Promise(resolve => {releaseB = resolve;});
  const seenA = new Promise(resolve => {startedA = resolve;});
  const seenB = new Promise(resolve => {startedB = resolve;});
  const h = harness({platform:'douban', fixture:'douban-comments', pageUrl, selectionWindow, activeTab:() => activeTab,
    prepare:(doc, window) => {window.getSelection = () => select(doc, 'Selected A');},
    captureGate:async tabId => {if (tabId === 7) {startedA(); await gateA;} else {startedB(); await gateB;}}
  });
  const toolbar = h.toolbar(); await seenA;
  activeTab = {id:8, url:selectionWindow.location.href};
  const second = secondCapture === "selection-menu" ? h.selectionMenu() : h.toolbar();
  const overlapped = await Promise.race([seenB.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
  activeTab = {id:7, url:pageUrl};
  releaseA(); releaseB();
  expect(overlapped).toBe(false);
  expect((await toolbar).ok).toBe(true);
  if (secondCapture === "selection-menu") expect((await second).kind).toBe('success');
  else expect((await second).ok).toBe(true);
  expect(h.calls.creates).toHaveLength(2);
  expect(h.calls.creates[0].contentMarkdown).toContain('Selected A');
  expect(h.calls.creates[0].contentMarkdown).not.toContain('Selected B');
  expect(h.calls.creates[1].contentMarkdown).toContain('Selected B');
  expect(h.calls.creates[1].contentMarkdown).not.toContain('Selected A');
  expect(h.calls.creates[1].contentMarkdown).toContain('https://example.test/selected-b');
});

for(const phase of ['capture','notebook','queued']) test(`selection menu rejects navigation during ${phase} without saving a different page`,async()=>{
 const selectionWindow=createWindow('<title>Original</title><p>Original selection</p>','https://example.test/original');
 let selected='Original selection';
 selectionWindow.getSelection=()=>({rangeCount:1,toString:()=>selected,getRangeAt:()=>({cloneContents:()=>{
  const fragment=selectionWindow.document.createDocumentFragment(),p=selectionWindow.document.createElement('p');p.textContent=selected;fragment.appendChild(p);return fragment;
 }})});
 const navigate=()=>{selectionWindow.location.href='https://example.test/next';selected='Other page selection';};
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{started=resolve;});
 const h=harness({selectionWindow,
  captureGate:async()=>{if(phase==='capture')navigate();},
  notebookRequested:()=>{if(phase==='notebook')navigate();if(phase==='queued')started();},
  notebookGate:phase==='queued'?gate:undefined,
 });
 let first;
 if(phase==='queued'){first=h.toolbar();await seen;}
 const menu=h.selectionMenu();
 if(phase==='queued'){navigate();release();await first;}
 expect((await menu).kind).toBe('error');
 expect(h.calls.feedback.at(-1).message).toContain('platformPageChanged');
 expect(h.calls.creates).toHaveLength(phase==='queued'?1:0);
 expect(h.calls.creates.every(memo=>!memo.contentMarkdown.includes('Other page selection'))).toBe(true);
});

for(const changed of [false,true]) test(`iframe selection ${changed?'navigation is rejected':'keeps its own source while binding the top-level tab'}`,async()=>{
 const selectionWindow=createWindow('<title>Frame</title><p>Frame selection</p>','https://frame.test/original');
 selectionWindow.getSelection=()=>({rangeCount:1,toString:()=> 'Frame selection',getRangeAt:()=>({cloneContents:()=>{
  const fragment=selectionWindow.document.createDocumentFragment(),p=selectionWindow.document.createElement('p');p.textContent='Frame selection';fragment.appendChild(p);return fragment;
 }})});
 const h=harness({selectionWindow,selectionFrameId:3,selectionTabUrl:()=> 'https://example.test/parent',captureGate:async()=>{if(changed)selectionWindow.location.href='https://frame.test/next';}});
 expect((await h.selectionMenu()).kind).toBe(changed?'error':'success');
 expect(h.calls.creates).toHaveLength(changed?0:1);
 if(!changed) {expect(h.calls.creates[0].contentMarkdown).toContain('https://frame.test/original');expect(h.calls.creates[0].contentMarkdown).not.toContain('https://example.test/parent');}
});

test('selection menu retains the browser text fallback when injection is unavailable on the same page',async()=>{
 const selectionWindow=createWindow('<title>Original</title>','https://example.test/original');selectionWindow.getSelection=()=>({toString:()=> 'Original selection'});
 const h=harness({selectionWindow,captureGate:async()=>{throw new Error('Cannot access contents of the page');}});
 expect((await h.selectionMenu()).kind).toBe('success');expect(h.calls.creates).toHaveLength(1);
 expect(h.calls.creates[0].contentMarkdown).toContain('Original selection');expect(h.calls.creates[0].contentMarkdown).toContain('https://example.test/original');
});

test("a timed-out capture's late reply cannot complete the next queued selection", async () => {
  const select = (doc, text) => ({rangeCount:1, toString: () => text, getRangeAt: () => ({cloneContents: () => {
    const fragment = doc.createDocumentFragment(), p = doc.createElement('p');
    p.textContent = text; fragment.appendChild(p); return fragment;
  }})});
  const selectionWindow = createWindow('<title>Page B</title><p>Selected B</p>', 'https://example.test/selected-b');
  selectionWindow.getSelection = () => select(selectionWindow.document, 'Selected B');
  let releaseA, releaseB, startedA, startedB, expireCapture;
  const gateA = new Promise(resolve => {releaseA = resolve;});
  const gateB = new Promise(resolve => {releaseB = resolve;});
  const seenA = new Promise(resolve => {startedA = resolve;});
  const seenB = new Promise(resolve => {startedB = resolve;});
  const h = harness({platform:'douban', fixture:'douban-comments', pageUrl:'https://book.douban.com/subject/36864764/comments/', selectionWindow,
    prepare:(doc, window) => {window.getSelection = () => select(doc, 'Selected A');},
    // Drive the actual capture timeout callback without waiting fifteen seconds.
    backgroundSetTimeout:(callback, delay, ...args) => {
      if (delay === 15_000) {expireCapture = callback; return 0;}
      return setTimeout(callback, delay, ...args);
    },
    captureGate:async tabId => {if (tabId === 7) {startedA(); await gateA;} else {startedB(); await gateB;}}
  });
  const toolbar = h.toolbar(); await seenA;
  const menu = h.selectionMenu();
  expireCapture();
  expect(await toolbar).toEqual({ok:false, message:'captureTimeout'});
  await seenB;
  releaseA();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.calls.creates).toHaveLength(0);
  releaseB();
  expect((await menu).kind).toBe('success');
  expect(h.calls.creates).toHaveLength(1);
  expect(h.calls.creates[0].contentMarkdown).toContain('Selected B');
  expect(h.calls.creates[0].contentMarkdown).not.toContain('Selected A');
  expect(h.calls.creates[0].contentMarkdown).toContain('https://example.test/selected-b');
});

for(const [platform,pageUrl,tag,author,time] of [
 ['medium-article','https://scottbatson.dev/what-should-programmers-do-while-the-ai-writes-code-a2ce2e6de88e','medium','Scott Batson',clipDateTimeText('2026-08-31T18:48:46Z')],
 ['substack-article','https://www.oneusefulthing.org/p/the-dot-and-the-swarm','substack','Ethan Mollick',clipDateTimeText('2026-10-01T18:54:12+08:00')],
]) test(`${platform}: actual capture/save keeps platform metadata and uses shared image archival`,async()=>{
 const h=harness({platform,pageUrl});expect(await h.toolbar()).toMatchObject({ok:true});
 expect(h.calls.creates).toHaveLength(1);const memo=h.calls.creates[0];expect(memo.tags).toEqual(['web-clip',tag]);expect(memo.contentMarkdown).toContain(author);expect(memo.contentMarkdown).toContain(time);expect(h.calls.uploads.length).toBeGreaterThan(0);expect(h.calls.saves[0].contentMarkdown).toContain('/api/v1/resources/');
});
test('Jike topic menu saves precisely the marked card while toolbar asks for a post or selection',async()=>{
 const h=harness({platform:'jike',fixture:'jike-feed',pageUrl:'https://m.okjike.com/topics/63579abb6724cc583b9bba9a',prepare:doc=>doc.querySelectorAll('.post-item-li')[1].setAttribute('data-edgeever-social-target','https://m.okjike.com/originalPosts/6ace942f756bbb66581c3f96')});
 expect(await h.mode()).toEqual({kind:'social-feed'});expect(await h.toolbar()).toEqual({ok:false,message:'socialSelectPost'});expect(h.calls.creates).toHaveLength(0);
 await h.menu();expect(h.calls.creates).toHaveLength(1);expect(h.calls.creates[0].contentMarkdown).toContain('JimHuiHui');expect(h.calls.creates[0].contentMarkdown).toContain('护城河');expect(h.calls.creates[0].contentMarkdown).not.toContain('Ambi');expect(h.calls.creates[0].tags).toEqual(['web-clip','jike']);expect(h.calls.uploads).toHaveLength(1);
});
test('a real Substack paywall warns and refuses a whole-article preview',async()=>{
 const h=harness({platform:'substack-article',fixture:'substack-paywall',pageUrl:'https://www.lennysnewsletter.com/p/how-to-build-ai-product-sense'});
 expect(await h.mode()).toEqual({kind:'page',platform:'Substack',access:'content-restricted'});expect(await h.toolbar()).toEqual({ok:false,message:'pageCaptureRestrictedHint'});expect(h.calls.creates).toHaveLength(0);expect(h.calls.uploads).toHaveLength(0);
});

test('Substack restricted article still saves an explicit visible passage',async()=>{
 const h=harness({platform:'substack-article',fixture:'substack-paywall',pageUrl:'https://www.lennysnewsletter.com/p/how-to-build-ai-product-sense',prepare:(doc,w)=>{
  w.getSelection=()=>({rangeCount:1,toString:()=> 'Selected visible passage',getRangeAt:()=>({cloneContents:()=>{const fragment=doc.createDocumentFragment(),p=doc.createElement('p');p.textContent='Selected visible passage';fragment.appendChild(p);return fragment;}})});
 }});
 expect(await h.toolbar()).toMatchObject({ok:true});expect(h.calls.creates).toHaveLength(1);expect(h.calls.creates[0].contentMarkdown).toContain('Selected visible passage');expect(h.calls.creates[0].contentMarkdown).not.toContain('Step 7');expect(h.calls.creates[0].tags).toEqual(['web-clip']);
});

test('Substack article identity survives missing body and refuses a paywall-only generic fallback',async()=>{
 for(const fixture of ['substack-paywall','substack-article']) for(const selector of ['.body.markup','h1.post-title']) {
  const h=harness({platform:'substack-article',fixture,pageUrl:fixture==='substack-paywall'?'https://www.lennysnewsletter.com/p/how-to-build-ai-product-sense':'https://www.oneusefulthing.org/p/the-dot-and-the-swarm',prepare:doc=>doc.querySelector(selector).remove()});
  expect((await h.mode()).platform).toBe('Substack');expect((await h.toolbar()).ok).toBe(false);expect(h.calls.creates).toHaveLength(0);
 }
});

for(const [platform,pageUrl] of [['medium-article','https://scottbatson.dev/what-should-programmers-do-while-the-ai-writes-code-a2ce2e6de88e'],['substack-article','https://www.oneusefulthing.org/p/the-dot-and-the-swarm']]) {
 for(const failure of ['failDownload','failUpload','failRewrite']) test(`${platform}: ${failure} keeps one note and reports incomplete image archival`,async()=>{
  const h=harness({platform,pageUrl,[failure]:true});expect(await h.toolbar()).toEqual({ok:true,message:'platformImagesPartial'});expect(h.calls.creates).toHaveLength(1);
 });
}

for(const failure of ['failDownload','failUpload','failRewrite']) test(`generic toolbar and selection report ${failure} instead of complete image archival`,async()=>{
 const html='<title>Article</title><article><p>Saved article content with enough text for the normal page extraction path and an embedded image.</p><img src="https://example.test/photo.png"></article>';
 const generic=harness({platform:'v2ex',pageUrl:'https://example.test/article',[failure]:true,prepare:doc=>{doc.documentElement.innerHTML=createDocument(html).documentElement.innerHTML;}});
 expect(await generic.toolbar()).toEqual({ok:true,message:'platformImagesPartial'});expect(generic.calls.creates).toHaveLength(1);
 const selectionWindow=createWindow(html,'https://example.test/article');
 selectionWindow.getSelection=()=>({rangeCount:1,toString:()=> 'Selected article',getRangeAt:()=>({cloneContents:()=>{const f=selectionWindow.document.createDocumentFragment();f.appendChild(selectionWindow.document.querySelector('article').cloneNode(true));return f;}})});
 const selection=harness({selectionWindow,[failure]:true});
 expect(await selection.selectionMenu()).toMatchObject({message:'platformImagesPartial',kind:'success'});expect(selection.calls.creates).toHaveLength(1);
});


for(const action of ['toolbar','menu']) test(`LinkedIn ${action} saves professional metadata without changing the author or publication label`,async()=>{
 const h=harness({platform:'linkedin',fixture:'linkedin-person',pageUrl:'https://www.linkedin.com/posts/maddyahmad_softwareengineering-artificialintelligence-share-7456582751698190336-6NVK/'});
 await h[action]();expect(h.calls.creates).toHaveLength(1);
 const note=h.calls.creates[0];
 expect(note.contentMarkdown).toContain('platformAuthorLabel: Mohammad Ahmed · Technical Lead - Backend at Dizzaract');
 expect(note.contentMarkdown).toContain('5 个月前');
 expect(note.contentMarkdown).toContain('urn:li:share:7456582751698190336');
 expect(note.contentMarkdown).not.toContain('3 度+');
 expect(note.tags).toEqual(['web-clip','linkedin']);
});

test('Xueqiu right-click on a truncated feed saves only the selected full public detail and archives its image',async()=>{
 const target='https://xueqiu.com/2754211668/411841572';
 const h=harness({platform:'xueqiu',fixture:'xueqiu-feed',pageUrl:'https://www.xueqiu.com/',prepare:doc=>{
  const link=Array.from(doc.querySelectorAll('a[class*="date-and-source_"]')).find(a=>a.getAttribute('href')==='/2754211668/411841572');
  link.closest('[class*="timeline__item__main_"]').setAttribute('data-edgeever-social-target',target);
 },detailLoad:frame=>{
  expect(frame.src).toBe('https://www.xueqiu.com/2754211668/411841572');expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
  return createWindow(readFileSync(new URL('./fixtures/platforms/xueqiu-feed-detail-second.html',import.meta.url),'utf8'),frame.src).document;
 }});
 await h.menu();expect(h.calls.creates).toHaveLength(1);
 expect(h.calls.creates[0].contentMarkdown).toContain('把自己的真金白银押在别人的嘴上，早晚是要付出代价的。');
 expect(h.calls.creates[0].contentMarkdown).toContain(target);
 expect(h.calls.creates[0].contentMarkdown).not.toContain('6114376649/411862401');
 expect(h.calls.creates[0].tags).toEqual(['web-clip','xueqiu','投资','09992','NTES']);
 expect(h.calls.uploads).toHaveLength(1);expect(h.calls.saves).toHaveLength(1);
 expect(JSON.stringify(h.calls.saves[0])).toContain('res_1');
 expect(JSON.stringify(h.calls.saves[0])).not.toContain('https://xqimg.imedao.com/');
});


for(const action of ['selection-menu','generic-toolbar','platform-toolbar','feed-toolbar']) test(`${action}: a queued click keeps A after the live selection becomes B`,async()=>{
 const url=action==='platform-toolbar'?'https://www.v2ex.com/t/1000000':action==='feed-toolbar'?'https://xueqiu.com/':'https://example.test/selection';
 const selectedWindow=createWindow('<title>Selected page</title><main><p>Original whole article content stays here.</p></main>',url);
 let selected='Original clicked A';
 selectedWindow.getSelection=()=>({rangeCount:1,toString:()=>selected,getRangeAt:()=>({cloneContents:()=>{const fragment=selectedWindow.document.createDocumentFragment(),p=selectedWindow.document.createElement('p');p.textContent=selected;fragment.appendChild(p);return fragment;}})});
 let activeTab={id:7,url:urls['hacker-news']},release,started;
 const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 const h=harness({selectionWindow:selectedWindow,activeTab:()=>activeTab,notebookGate:gate,notebookRequested:started});
 const first=h.toolbar();await seen;activeTab={id:8,url};
 const second=action==='selection-menu'?h.selectionMenu():h.toolbar();
 await new Promise(resolve=>setTimeout(resolve,0));selected='Later unrequested B';release();
 await first;const result=await second;
 expect(action==='selection-menu'?result.kind==='success':result.ok).toBe(true);
 expect(h.calls.creates).toHaveLength(2);expect(h.calls.creates[1].contentMarkdown).toContain('Original clicked A');
 expect(h.calls.creates[1].contentMarkdown).not.toContain('Later unrequested B');
});

test('a whole-page toolbar click cannot become a later selection while queued',async()=>{
 const url='https://example.test/whole-page',selectedWindow=createWindow('<title>Whole page</title><main><p>Original whole article content stays here and contains several sentences for reading.</p></main>',url);
 let selected='';selectedWindow.getSelection=()=>selected?{rangeCount:1,toString:()=>selected,getRangeAt:()=>({cloneContents:()=>{const f=selectedWindow.document.createDocumentFragment();f.appendChild(selectedWindow.document.createTextNode(selected));return f;}})}:null;
 let activeTab={id:7,url:urls['hacker-news']},release,started;
 const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 const h=harness({selectionWindow:selectedWindow,activeTab:()=>activeTab,notebookGate:gate,notebookRequested:started});
 const first=h.toolbar();await seen;activeTab={id:8,url};const second=h.toolbar();
 await new Promise(resolve=>setTimeout(resolve,0));selected='Later selected B';release();await first;expect((await second).ok).toBe(true);
 expect(h.calls.creates[1].contentMarkdown).toContain('Original whole article content');expect(h.calls.creates[1].contentMarkdown).not.toContain('Later selected B');
});

test('selection feedback delay cannot change the clicked passage',async()=>{
 const selectedWindow=createWindow('<title>Selection</title><main>Original text</main>','https://example.test/selection');
 let selected='Original clicked A',release,started;
 const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 selectedWindow.getSelection=()=>({rangeCount:1,toString:()=>selected,getRangeAt:()=>({cloneContents:()=>{const f=selectedWindow.document.createDocumentFragment();f.appendChild(selectedWindow.document.createTextNode(selected));return f;}})});
 const h=harness({selectionWindow:selectedWindow,feedbackGate:()=>{started();return gate;}}),pending=h.selectionMenu();
 await seen;selected='Later unrequested B';release();expect((await pending).kind).toBe('success');
 expect(h.calls.creates[0].contentMarkdown).toContain('Original clicked A');expect(h.calls.creates[0].contentMarkdown).not.toContain('Later unrequested B');
});

test('changed selection saves the original literal text without Markdown reinterpretation', async () => {
 const original='First\n====\n\n    const value = a * b;\n    if (value < 10) run();\n\n[title](https://example.test) &copy;';
 const selectedWindow=createWindow('<title>Selection</title><main>Original text</main>','https://example.test/selection');
 let selected=original,release,started;
 const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>started=resolve);
 selectedWindow.getSelection=()=>({rangeCount:1,toString:()=>selected,getRangeAt:()=>({cloneContents:()=>{const f=selectedWindow.document.createDocumentFragment();f.appendChild(selectedWindow.document.createTextNode(selected));return f;}})});
 const h=harness({selectionWindow:selectedWindow,feedbackGate:()=>{started();return gate;}}),pending=h.selectionMenu();
 await seen;selected='Later unrequested B';release();expect((await pending).kind).toBe('success');
 const doc=markdownToDoc(h.calls.creates[0].contentMarkdown),nodes=[];
 const visit=node=>{nodes.push(node);(node.content||[]).forEach(visit);};visit(doc);
 expect(nodes.some(node=>['heading','codeBlock','image'].includes(node.type))).toBe(false);
 expect(nodes.filter(node=>node.type==='text').map(node=>node.text).join('').replace(/\n/g,'')).toStartWith(original.replace(/\n/g,''));
 expect(JSON.stringify(doc)).not.toContain('Later unrequested B');
});

test('stable rich selection preserves code blank lines and archives its selected image',async()=>{
 const code='const first = 1;\n\n\nconst second = 2;',url='https://example.test/selection',selectedWindow=createWindow('<title>Code selection</title><main></main>',url);
 selectedWindow.getSelection=()=>({rangeCount:1,toString:()=>code,getRangeAt:()=>({cloneContents:()=>{
  const f=selectedWindow.document.createDocumentFragment(),pre=selectedWindow.document.createElement('pre'),el=selectedWindow.document.createElement('code'),image=selectedWindow.document.createElement('img');
  el.className='language-js';el.textContent=code;pre.appendChild(el);f.appendChild(pre);image.src='https://example.test/selected.png';f.appendChild(image);return f;
 }})});
 const h=harness({selectionWindow:selectedWindow});expect((await h.selectionMenu()).kind).toBe('success');
 const doc=markdownToDoc(h.calls.saves[0].contentMarkdown);
 expect(doc.content.find(node=>node.type==='codeBlock').content[0].text).toBe(code);
 expect(h.calls.uploads).toHaveLength(1);expect(JSON.stringify(doc)).toContain('/api/v1/resources/res_1/blob');
});

for(const navigate of [false,true])test(`current signed-in Jike Web detail ${navigate?'cancels navigation':'saves through the platform route'}`,async()=>{
 const pageUrl='https://web.okjike.com/u/5e6497e7-a69f-422b-af6e-baf0fc07b512/post/64c9dd9a2edae6abdc610605';
 const h=harness({platform:'jike',pageUrl,fixture:'jike-web-detail',prepare:doc=>prepareJikeWebDetail(doc),navigateDuringNotebookLookup:navigate});
 expect((await h.toolbar()).ok).toBe(!navigate);expect(h.calls.creates).toHaveLength(navigate?0:1);
 if(!navigate){expect(h.calls.creates[0].contentMarkdown).toContain('https://m.okjike.com/originalPosts/64c9dd9a2edae6abdc610605');expect(h.calls.creates[0].contentMarkdown).not.toContain('Do not capture comments');expect(h.calls.uploads).toHaveLength(1);}
});

const webJikePosts=JSON.parse(readFileSync(new URL('./fixtures/platforms/jike-web-feed.posts.json',import.meta.url),'utf8'));
const prepareWebJike=(doc,window)=>{
 const cards=[...doc.querySelectorAll('[data-clickable-feedback]')].filter(c=>c.querySelector('header')&&c.querySelector('[class*="_contentWrapper_"]'));
 cards.forEach((card,i)=>card.__reactProps$fixture={children:{props:{data:structuredClone(webJikePosts[i])}}});
 cards[0].setAttribute('data-edgeever-jike-selected','');let notify=()=>{};
 window.MutationObserver=class{constructor(fn){notify=fn;}observe(){}disconnect(){}};
 cards[0].querySelector('[class*="_expandButton_"]').addEventListener('click',e=>{e.target.textContent='收起';notify();});
 return cards;
};

test('native Jike Web feed menu resolves current props and expands only the selected original post',async()=>{
 const h=harness({platform:'jike',fixture:'jike-web-feed',pageUrl:'https://web.okjike.com/following',prepare:prepareWebJike});
 expect((await h.menu()).kind).toBe('success');expect(h.calls.creates).toHaveLength(1);
 const md=h.calls.creates[0].contentMarkdown;expect(md).toContain('https://m.okjike.com/originalPosts/'+webJikePosts[0].id);
 expect(md).toContain('感谢以上即友的创作与分享');expect(md).not.toContain('2026年10月16日');expect(md).not.toContain('收起');
 expect(md).toContain('https://web.okjike.com/u/71b51e1e-ece6-4855-b1d9-98703b7c1507');
 expect(h.calls.requests.every(url=>url.startsWith('https://edgeever.test/'))).toBe(true);
});

test('Jike Web card identity recycling during notebook lookup cancels before creating a memo',async()=>{
 let cards,release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const h=harness({platform:'jike',fixture:'jike-web-feed',pageUrl:'https://web.okjike.com/following',prepare:(d,w)=>{cards=prepareWebJike(d,w);cards[0].querySelector('[class*="_expandButton_"]').remove();},notebookRequested:entered,notebookGate:gate});
 const pending=h.menu();await started;
 cards[0].__reactProps$fixture.children.props.data.id='6715e824d9dc81724c2ec74d';release();
 expect(await pending).toMatchObject({kind:'error',message:'platformPageChanged'});expect(h.calls.creates).toHaveLength(0);
});

for(const stage of ['before-capture','during-notebook-lookup'])test(`Jike Web detail same-author post mismatch ${stage} creates no memo`,async()=>{
 const a='64c9dd9a2edae6abdc610605',b='6715e824d9dc81724c2ec74d';
 let card,release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const h=harness({platform:'jike',fixture:'jike-web-detail',pageUrl:`https://web.okjike.com/u/5e6497e7-a69f-422b-af6e-baf0fc07b512/post/${stage==='before-capture'?b:a}`,
 prepare:doc=>{card=prepareJikeWebDetail(doc);card.setAttribute('data-edgeever-jike-id',b);},
 ...(stage==='during-notebook-lookup'?{notebookRequested:entered,notebookGate:gate}:{})});
 const pending=h.toolbar();
 if(stage==='during-notebook-lookup'){await started;card.__reactProps$fixture.children.props.data.id=b;release();}
 expect(await pending).toMatchObject({ok:false,message:'platformPageChanged'});expect(h.calls.creates).toHaveLength(0);
});

test('legacy Jike Web share detail retains its H5 data identity checks',async()=>{
 const h=harness({platform:'jike',fixture:'jike',pageUrl:'https://web.okjike.com/originalPost/66ac89b0314f5cced41012d3'});
 expect((await h.toolbar()).ok).toBe(true);expect(h.calls.creates).toHaveLength(1);
});

test('Jike Web detail rejects DOM from another post even when current props match the route',async()=>{
 const h=harness({platform:'jike',fixture:'jike-web-detail',pageUrl:'https://web.okjike.com/u/5e6497e7-a69f-422b-af6e-baf0fc07b512/post/64c9dd9a2edae6abdc610605',prepare:doc=>{
 const card=prepareJikeWebDetail(doc);card.querySelector('[class*="_contentWrapper_"] [class^="_content_"]').textContent='Another post still being rendered';
 }});
 expect((await h.toolbar()).ok).toBe(false);expect(h.calls.creates).toHaveLength(0);
});

for(const variant of ['normal','images-only','changed-image'])test(`Jike Web gallery detail ${variant} verifies content and retains nine images`,async()=>{
 const h=harness({platform:'jike',fixture:'jike-web-grid',pageUrl:'https://web.okjike.com/u/af47ed7e-38d4-4798-acd6-04e3cc8d131c/post/6715e824d9dc81724c2ec74d',prepare:doc=>{
 const card=prepareJikeWebDetail(doc,'6715e824d9dc81724c2ec74d');
 if(variant==='images-only'){card.querySelector('[class*="_contentWrapper_"] [class^="_content_"]').remove();card.__reactProps$fixture.children.props.data.content='';}
 if(variant==='changed-image')card.querySelector('img[data-anonymous-gallery="true"]').setAttribute('src','https://cdnv2.ruguoapp.com/another-post.jpg');
 }});
 expect((await h.toolbar()).ok).toBe(variant!=='changed-image');expect(h.calls.creates).toHaveLength(variant==='changed-image'?0:1);
 if(variant!=='changed-image')expect(h.calls.uploads).toHaveLength(9);
});

test('Jike Web detail expands its selected card before verifying the full public body',async()=>{
 const h=harness({platform:'jike',fixture:'jike-web-detail',pageUrl:'https://web.okjike.com/u/5e6497e7-a69f-422b-af6e-baf0fc07b512/post/64c9dd9a2edae6abdc610605',prepare:(doc,window)=>{
 const card=prepareJikeWebDetail(doc),body=card.querySelector('[class*="_contentWrapper_"]'),text=body.querySelector('[class^="_content_"]'),full=text.innerHTML;
 text.textContent='我在即刻写东西的核心原则是…';const button=doc.createElement('button');button.textContent='展开全文';body.appendChild(button);
 let notify=()=>{};window.MutationObserver=class{constructor(fn){notify=fn;}observe(){}disconnect(){}};
 button.addEventListener('click',()=>{text.innerHTML=full;button.remove();notify();});
 }});
 expect((await h.toolbar()).ok).toBe(true);expect(h.calls.creates).toHaveLength(1);expect(h.calls.creates[0].contentMarkdown).toContain('《斯坦福大学人生设计课》');
});
