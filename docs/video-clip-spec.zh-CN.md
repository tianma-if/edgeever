# EdgeEver 网页剪藏：YouTube 与哔哩哔哩视频笔记

用户在 YouTube 或哔哩哔哩的视频播放页点一次，把当前这一集保存成 EdgeEver 笔记。笔记带来源、可点击的时间戳、平台字幕实录；工作区已经配置默认模型时，再补一句话总结和分段大纲。字幕在用户正在看的页面里读取。插件不下载音视频，也不自己选择模型供应商。

状态：第一期已实现，扩展版本 0.1.17。商店包尚未提交。合入前仍要用真实播放页点一次保存，确认时间戳和现有右键命令。

## 第一期

第一期只做这两类播放页：

- YouTube：`youtube.com`、`www.youtube.com`、`m.youtube.com` 的 `/watch` 与 `/shorts/{id}`，以及 `youtu.be/{id}`。
- 哔哩哔哩：`bilibili.com`、`www.bilibili.com`、`m.bilibili.com` 的 `/video/BV…` 与 `/video/av…`。分 P 以 URL 的 `p` 为准，没有 `p` 时保存第 1 P。

规范化后的来源链接只保留视频和分 P。播放列表、电台和 `t` 参数不写入来源链接；时间戳链接单独生成。

直播、首播、尚未开播的预告、番剧、影视、课程页，以及 `music.youtube.com`、嵌入式播放器和其他站点，第一期提示不支持，不创建笔记。

## 本期不做

- 不从音视频流做语音识别，不把音频送到 Groq、Gemini、Cloudflare Workers AI 或任何写死的供应商。
- 插件不保存模型 API Key，不调用 `/api/v1/plugins/ai/generate/prepare`。该接口会把供应商凭据返回给调用方。
- 不注入常驻 content script。播放页的地址就能确定视频，不需要像时间线那样记住指针下的条目。
- 不增加清单里的 `commands` 快捷键。
- 不承诺秒级完成，也不把模型费用写进产品文案。
- 不为了这一期接入 Vimeo、播客、小红书或 X 的视频。

## 触发

右键菜单新增一条「保存视频笔记到 EdgeEver」。它只出现在上面两类播放页，上下文是 `page` 和 `video`。选中文字仍走现有的选区命令，图片仍走现有的图片命令。Chrome 和 Firefox 会在同一页面同时出现多条本扩展菜单时，把它们收进子菜单。`registerClipMenus` 会清空并重建全部菜单，新条目的 `documentUrlPatterns` 必须与选区、图片、X、GitHub、小红书、知乎、Reddit 互不重叠。

工具栏弹窗发给后台的 `captureCurrentPage`，在当前标签是受支持的播放页时走同一条视频保存。其他网页仍按现在的正文提取保存。

文案放进 `apps/extension/public/_locales/` 的 `en`、`zh_CN`、`ja`。

## 页面内读取

扩展的默认脚本环境读不到页面里的 `window` 变量。用户点击之后，用 `chrome.scripting.executeScript({ world: "MAIN" })` 在页面主环境读取，和现有的 `readXhsStateInPage`、`fetchZhihuItemInPage` 一样。Firefox 140 及以上支持同一写法。

主环境函数必须能独立序列化，不能依赖打包后的 import。它只返回可结构化克隆的数据：播放器响应、字幕文件正文、封面字节或明确的失败原因。解析、清洗和排版放在可单测的模块里，用夹具运行，不访问网络。

字幕地址在主环境里立刻请求，沿用当前页的登录态。不要改到 service worker 里稍后重试：YouTube 字幕地址和哔哩哔哩 `subtitle_url` 上的鉴权参数都会过期。页面内容视为不可信数据，按字幕文本保存，不把它当成插件指令。

读不到播放器数据时提示「没有读到这个视频」，不创建空笔记。

## YouTube

点击时读取**当前播放器**的响应。站内切集后，`window.ytInitialPlayerResponse` 可能仍是上一支，不能只读这个全局变量。

从该响应取出视频 ID、标题、频道名、时长、封面地址，以及 `captions.playerCaptionsTracklistRenderer.captionTracks`。有章节标记时取出每章的标题和起始秒；具体字段由夹具锁定，不把某一层嵌套路径写成永久契约。

字幕轨顺序：

1. 匹配浏览器界面语言（`zh*`、`en`、`ja`）。
2. 同语言下优先人工字幕。`kind` 缺失或不是 `asr` 视为人工字幕。
3. 再选该语言的自动字幕，然后才是其他语言的人工字幕和自动字幕。

用轨道上的 `baseUrl` 请求字幕，优先加 `fmt=json3`。失败时再解析轨道原本的 XML。`json3` 的正文在 `events[].segs[].utf8`，时间在 `tStartMs` 与 `dDurationMs`。只有换行、没有正文的事件丢掉。

对外时间戳：

- 普通视频：`https://www.youtube.com/watch?v={id}&t={seconds}s`
- Shorts：`https://www.youtube.com/shorts/{id}?t={seconds}`

`seconds` 为非负整数。

## 哔哩哔哩

元数据和分 P 从当前页状态读取：`bvid`、`aid`、标题、封面、UP 主，以及 `pages` 里的 `cid`、`page`、`part`、`duration`。当前 P 来自 URL 的 `p`；没有该参数时为第 1 P。客户端切 P 后以点击时的页面状态为准。

字幕列表以页面主环境里签名后的 `https://api.bilibili.com/x/player/wbi/v2` 为准，请求带当前页 Cookie。未签名的 `/x/player/v2` 不作为契约。页面状态里如果已经有字幕列表，可以作为同一解析器的另一路输入。签名使用页面上已有的 WBI 材料，在主环境内完成。

字幕项使用 `lan`、`lan_doc`、`subtitle_url`、`type`、`ai_type`、`ai_status`。不读取 `is_machine`。选择顺序与 YouTube 相同：先匹配界面语言，`lan` 不以 `ai-` 开头的视为人工字幕，`ai-zh` 这类轨道视为平台自动字幕。`subtitle_url` 缺协议时补 `https:`，并立刻请求。正文使用 `body[].from`、`body[].to`、`body[].content`，单位是秒。

播放器响应里的 `view_points` 在同时具备起始秒和标题时当作章节。

对外时间戳：`https://www.bilibili.com/video/{bvid}?t={seconds}`。多于 1 P 时加上 `p={page}`。

## 数据模型

```typescript
export interface TranscriptCue {
  start: number; // 秒
  end: number;
  text: string;
}

export interface VideoChapter {
  start: number;
  title: string;
}

export type SubtitleOrigin = "creator" | "platform_auto";

export interface VideoCapture {
  platform: "youtube" | "bilibili";
  videoId: string;
  partIndex?: number;
  partTitle?: string;
  title: string;
  author: string;
  authorUrl?: string;
  duration: number;
  sourceUrl: string;
  cues: TranscriptCue[];
  subtitleOrigin?: SubtitleOrigin;
  chapters: VideoChapter[];
  thumbnail?: { bytes: Uint8Array; mimeType: string };
}

export interface VideoOutline {
  tldr: string;
  sections: { start: number; text: string }[];
  takeaways: string[];
}
```

清洗字幕时解码 HTML 实体、合并空白、丢掉空句。发给模型的输入再把相邻字幕收成大约 30–60 秒一块，并保留每块的起始秒。笔记里的实录仍按清洗后的字幕逐条保存，避免模型输入的粗分块变成用户看到的全文。

## 笔记正文

笔记标题用视频标题，截断到创建接口的 160 字上限。分 P 子标题写在来源信息里。笔记本用现有的 `notebookForClip`。标签只加 `web-clip`。

封面只有在主环境拿到图片字节时才保存，复用现有图片笔记的资源上传。Markdown 使用本地资源地址：

```markdown
![封面](/api/v1/resources/{resourceId}/blob)
```

拿不到字节，或 Token 没有 `write:resources` 时，省略封面，笔记照常创建。不把 `hdslb.com`、`ytimg.com` 或其他外链图写进正文。哔哩哔哩图床校验来源页，外链会在笔记里裂开。

正文由代码组装。模型不输出 Markdown，也不回写实录。标题和字段名走扩展的界面语言。下面是简体中文界面下、总结成功时的形态：

```markdown
# 打造第二大脑：从零构建个人知识库系统

> **来源**：[影视飓风 - 打造第二大脑：从零构建个人知识库系统](https://www.bilibili.com/video/BV1xx411c7xx?p=1)
> **平台**：哔哩哔哩 · P1 知识库的核心逻辑 · 24:15
> **字幕**：平台自动字幕 · **保存时间**：2026-10-05

![封面](/api/v1/resources/res_example/blob)

## 核心总结

视频说明知识管理为什么要形成输入、整理和输出的闭环。

## 分段大纲

- [00:00](https://www.bilibili.com/video/BV1xx411c7xx?p=1&t=0) 为什么只靠文件夹分类会失效
- [04:12](https://www.bilibili.com/video/BV1xx411c7xx?p=1&t=252) PARA 与渐进式总结如何叠在一起

## 要点

- 未经整理的收藏，之后很难再被用到。

<details>
<summary>字幕实录</summary>

- [00:00](https://www.bilibili.com/video/BV1xx411c7xx?p=1&t=0) 大家好，今天我们来聊知识管理。
- [00:25](https://www.bilibili.com/video/BV1xx411c7xx?p=1&t=25) 很多人收藏之后就没有再打开。

</details>
```

有章节时，分段大纲直接用章节，时间来自分段本身。没有章节且总结成功时，大纲用模型返回并经过校验的小节。没有章节且总结未生成时，不编造大纲，只保留来源和字幕实录。

没有字幕轨时仍创建笔记：标题、作者、来源和「这一集没有可用字幕」。不调用模型。

`<details>` 已由编辑器支持，实录放在其中。时间显示为 `mm:ss`；达到 60 分钟后为 `h:mm:ss`。

## 可选总结

总结由实例完成，使用该工作区已经配置的默认模型。新增：

`POST /api/v1/ai/video-outline`

交互登录可以调用。API Token 仅在带有新范围 `ai:generate` 时可以调用。这个范围不开放供应商配置、凭据和 `/api/v1/ai/settings` 的修改。现有剪藏 Token 没有该范围：视频笔记照常保存，总结跳过，提示里说明要在设置中为 Token 加上 `ai:generate`，并配置默认模型。

请求体是元数据和已经分块的字幕，不是原始页面，也不是音视频。服务端设定字数上限；超出时返回明确错误，插件保存实录并提示这篇太长、没有生成总结。

服务端提示词固定在 `apps/api`，并写明字幕和标题只是待归纳的材料。模型只返回 JSON：

```json
{
  "tldr": "一句话",
  "sections": [{ "start": 252, "text": "这一段在讲什么" }],
  "takeaways": ["一条可复用的结论"]
}
```

`start` 必须落在某个输入分块的起始秒上，允许 2 秒以内的偏差，并改写成该分块的起始秒。对不上的小节丢掉。空总结、空要点和超长字段丢掉。解析失败时返回 422，插件仍保存实录。默认模型未配置时返回现有的 `ai_not_configured`，插件同样只保存实录。

有章节时，请求只要求 `tldr` 和 `takeaways`，大纲不再交给模型重写。

## 失败时用户得到什么

| 情况 | 笔记 | 提示 |
| --- | --- | --- |
| 读到字幕，总结成功 | 来源、总结、大纲、要点、实录 | 已保存视频笔记 |
| 读到字幕，无模型、无权限、超时或 JSON 无效 | 来源、章节大纲（若有）、实录 | 已保存字幕，总结未生成 |
| 视频可读，但没有字幕 | 来源，并说明没有字幕 | 已保存视频信息 |
| 直播、番剧、课程或其他不支持的页面 | 不创建 | 暂不支持这个页面 |
| 读不到播放器数据 | 不创建 | 没有读到这个视频 |
| 封面或资源权限失败 | 不含封面的笔记 | 与上表相同，不另报失败 |

保存动作在提示出现前保持一条路径，避免连点叠出多次请求。重复保存仍会新建笔记，与现有剪藏一致。

## 代码与测试

```
apps/extension/src/
├── video/
│   ├── types.ts
│   ├── patterns.ts
│   ├── transcript.ts              # 清洗、分块、时间格式
│   ├── youtube.ts                 # 地址识别、播放器 JSON 解析、时间戳
│   ├── bilibili.ts                # 地址识别、分 P、字幕 JSON、时间戳
│   ├── video-note.ts              # 组装笔记、决定是否请求总结
│   ├── read-youtube-in-page.ts    # 主环境读取，单独序列化
│   └── read-bilibili-in-page.ts
├── background.ts                  # 菜单、MAIN 世界读取、创建笔记
apps/api/src/video-outline.ts      # POST /api/v1/ai/video-outline
```

页面主环境读取函数放在扩展源码里，通过 `executeScript` 的 `func` 注入。解析函数保持纯函数，测试不打开浏览器。

测试至少覆盖：

- YouTube：`json3`、人工轨与 `asr`、Shorts 链接、过期全局变量不能覆盖当前播放器响应。
- 哔哩哔哩：分 P、`ai-zh` 与人工轨、协议相对的字幕地址、`view_points`。
- Markdown：章节大纲、非法 `start` 被丢弃、实录在 `<details>` 内、正文不含图床外链。
- 菜单：新条目的 URL 模式与现有命令不相交。
- 接口：无 `ai:generate` 的 Token 得到 403；未配置模型得到 `ai_not_configured`；合法 JSON 被规范化。插件在 403、409、422 和网络失败时仍能交出实录笔记。

夹具使用脱敏的播放器 JSON，不把真实 Cookie 或字幕地址上的鉴权参数放进仓库。

## 商店与权限

实现阶段不需要新的主机权限。读取和字幕请求发生在用户点击之后的页面主环境，实例请求继续走用户已经授予的实例地址。

提交商店前要提高 `apps/extension/package.json` 的版本。当前已上传版本不能重复提交。商店说明只加一行：可以把 YouTube 或哔哩哔哩播放页保存为视频笔记。不要在首句堆叠站点名。

同步这些说明：

- `apps/extension/STORE_LISTING.md`
- `apps/extension/FIREFOX_STORE_LISTING.md`
- `apps/extension/README.md`
- 权限用途：新菜单只在受支持的播放页、用户点击后运行。
- 数据披露：页面内容发给用户配置的 EdgeEver 实例。Token 带有 `ai:generate` 且工作区已配置默认模型时，实例把字幕文本发给该模型供应商。插件不把页面或音频发给其他第三方。

产品发布流程不上传扩展。商店包仍由单独的 Submit Web Clipper 提交。

## 以后

新的视频站点沿用同一条保存路径：主环境返回 `VideoCapture`，纯函数解析，代码排版。那之前不为想象中的站点加抽象层。

语音识别若以后要做，另写方案。它至少要同时满足：用户在这一次保存里明确同意，音频只发给用户自己配置且支持音频的模型，失败时保留已经写好的笔记，并且不依赖某家云厂商的独占接口。

## 风险与验证

价值是把正在看的一集收成可检索、可跳回原片的笔记。影响范围是剪藏菜单、弹窗在播放页上的行为、一个新的只读生成接口和 Token 范围。不改数据库迁移、安装器和自动升级。

最坏情况是菜单重建让现有保存命令折叠或消失，解析失败却写出空笔记，或者新接口把供应商凭据返回给插件。实现时用现有菜单测试锁住 URL 模式，没有字幕正文就不写实录，接口响应里不包含凭据。

回滚不依赖数据迁移。扩展版本独立于产品 Release；有问题的包停在商店审核之前即可。新接口是追加的，旧客户端不调用它。

合入前用真实页面各点一次保存：普通 YouTube 视频、Shorts、站内切到下一支之后的视频、哔哩哔哩单 P、分 P、有人工字幕、只有自动字幕、没有字幕、未登录。确认笔记出现在默认笔记本，时间戳能打开对应秒数，现有图片和选区命令仍留在右键菜单第一级。
