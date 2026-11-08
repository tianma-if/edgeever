const WECHAT_TRANSCRIPT_NAME = "聊天记录.txt";
const PREFERRED_MEDIA_DIRECTORY = "聊天记录内的图片、视频和文件/";
const MEDIA_LINE = /^\[(图片|视频|文件|语音)\]\s+(.+?)\s*$/;
const LINK_LINE = /^\[链接\]\s+(.+)$/;
const DATE_LINE = /^\d{4}年\d{1,2}月\d{1,2}日 \d{1,2}:\d{2}(?::\d{2})?$/;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  pdf: "application/pdf",
};

const basename = (path) => path.replace(/\/+$/, "").split("/").at(-1) || "";

const extensionOf = (filename) => filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

const mimeTypeFor = (filename) => MIME_TYPES[extensionOf(filename)] ?? "application/octet-stream";

const isImage = (filename) => IMAGE_EXTENSIONS.has(extensionOf(filename));

const escapeMarkdownText = (value) => value.replace(/[\\`*[\]_]/g, "\\$&");
const escapeMarkdownLabel = (value) => value.replace(/[\\[\]]/g, "\\$&");

const isWeChatChatFile = (name) => {
  const base = basename(name);
  return Boolean(base && !name.endsWith("/") && base !== ".DS_Store" && !name.startsWith("__MACOSX/") && !base.startsWith("._"));
};

const isMessageHeader = (lines, index) =>
  index + 1 < lines.length && lines[index].startsWith("·") && DATE_LINE.test(lines[index + 1].trim());

const parseMessages = (text) => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const sections = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === "") index += 1;
    if (index >= lines.length) break;
    if (!isMessageHeader(lines, index)) {
      const start = index;
      while (index < lines.length && !isMessageHeader(lines, index)) index += 1;
      const raw = lines.slice(start, index).join("\n").trim();
      if (raw) sections.push({ raw: raw.split("\n") });
      continue;
    }
    const sender = lines[index].slice(1).trim();
    const time = lines[index + 1].trim();
    index += 2;
    const body = [];
    while (index < lines.length) {
      if (lines[index].trim() === "") {
        let next = index + 1;
        while (next < lines.length && lines[next].trim() === "") next += 1;
        if (next >= lines.length || isMessageHeader(lines, next)) {
          index = next;
          break;
        }
      }
      if (isMessageHeader(lines, index)) break;
      body.push(lines[index]);
      index += 1;
    }
    sections.push({ sender, time, body });
  }
  return sections;
};

const WECHAT_EMOJI_MAP = {
  "[微笑]": "😊",
  "[撇嘴]": "🥺",
  "[色]": "😍",
  "[发呆]": "😶",
  "[得意]": "😎",
  "[流泪]": "😭",
  "[害羞]": "😳",
  "[闭嘴]": "🤐",
  "[睡]": "😴",
  "[大哭]": "😭",
  "[尴尬]": "😅",
  "[发怒]": "😡",
  "[调皮]": "😜",
  "[呲牙]": "😁",
  "[惊讶]": "😲",
  "[难过]": "🙁",
  "[抓狂]": "😫",
  "[吐]": "🤮",
  "[偷笑]": "🤭",
  "[愉快]": "😄",
  "[白眼]": "🙄",
  "[傲慢]": "😤",
  "[困]": "🥱",
  "[惊恐]": "😱",
  "[憨笑]": "😄",
  "[悠闲]": "😌",
  "[咒骂]": "🤬",
  "[疑问]": "❓",
  "[嘘]": "🤫",
  "[晕]": "😵",
  "[衰]": "😞",
  "[骷髅]": "💀",
  "[敲打]": "🔨",
  "[再见]": "👋",
  "[擦汗]": "😓",
  "[抠鼻]": "🤏",
  "[鼓掌]": "👏",
  "[坏笑]": "😏",
  "[左哼哼]": "😤",
  "[右哼哼]": "😤",
  "[鄙视]": "😒",
  "[委屈]": "🥺",
  "[快哭了]": "😢",
  "[阴险]": "😏",
  "[亲亲]": "😘",
  "[可怜]": "🥺",
  "[笑脸]": "🙂",
  "[生病]": "🤒",
  "[脸红]": "😳",
  "[破涕为笑]": "😂",
  "[恐惧]": "😨",
  "[失望]": "😞",
  "[无语]": "🙄",
  "[嘿哈]": "🤣",
  "[捂脸]": "🤦",
  "[奸笑]": "😏",
  "[机智]": "🤓",
  "[皱眉]": "😟",
  "[耶]": "✌️",
  "[吃瓜]": "🍉",
  "[加油]": "💪",
  "[汗]": "😅",
  "[天啊]": "😱",
  "[Emm]": "🤔",
  "[社会社会]": "🤝",
  "[旺柴]": "🐕",
  "[好的]": "👌",
  "[打脸]": "🤦",
  "[加油加油]": "🎉",
  "[哇]": "🤩",
  "[翻白眼]": "🙄",
  "[666]": "🤙",
  "[让我看看]": "👀",
  "[叹气]": "😮‍💨",
  "[苦涩]": "🥲",
  "[裂开]": "💔",
  "[嘴唇]": "💋",
  "[爱心]": "❤️",
  "[心碎]": "💔",
  "[蛋糕]": "🎂",
  "[炸弹]": "💣",
  "[便便]": "💩",
  "[月亮]": "🌙",
  "[太阳]": "☀️",
  "[拥抱]": "🫂",
  "[强]": "👍",
  "[弱]": "👎",
  "[握手]": "🤝",
  "[胜利]": "✌️",
  "[抱拳]": "🤛",
  "[勾引]": "🤙",
  "[拳头]": "✊",
  "[OK]": "👌",
  "[合十]": "🙏",
  "[点赞]": "👍",
  "[玫瑰]": "🌹",
  "[凋谢]": "🥀",
  "[红包]": "🧧",
};

const WECHAT_SPECIAL_TOKENS = new Set([
  "动画表情",
  "视频号",
  "小程序",
  "微信红包",
  "位置",
  "名片",
  "语音通话",
  "视频通话",
  "微信转账",
]);

const renderTextMessage = (line) => {
  let text = line;
  for (const [key, emoji] of Object.entries(WECHAT_EMOJI_MAP)) {
    text = text.replaceAll(key, emoji);
  }
  text = text.replace(/\[([^\]]+)\]/g, (match, inner) => {
    if (WECHAT_SPECIAL_TOKENS.has(inner)) {
      return `\uE000${inner}\uE001`;
    }
    return match;
  });
  let escaped = escapeMarkdownText(text);
  escaped = escaped.replace(/\uE000(.*?)\uE001/g, "*[$1]*");
  return escaped;
};

const parseLink = (line) => {
  const match = LINK_LINE.exec(line.trim());
  if (!match) return null;
  const urlMatch = match[1].match(/^(.*?)(https?:\/\/[^\s)]+)$/);
  if (!urlMatch) return null;
  const title = urlMatch[1].trim();
  if (!title) return null;
  return { title, url: urlMatch[2] };
};

const mediaMarkdown = (item) => {
  const label = escapeMarkdownLabel(item.filename);
  const url = `edgeever-wechat-media://${item.id}`;
  return isImage(item.filename) ? `![${label}](${url})` : `[附件：${label}](${url})`;
};

const QUOTE_SEPARATOR = /^[-—─\s]{5,}$/;

const renderBody = (lines, mediaByName) => {
  const rendered = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    // 识别微信引用回复：以「开头，以」结尾，紧随其后是分隔线
    if (trimmed.startsWith("「")) {
      let quoteEndIndex = -1;
      for (let cursor = index; cursor < lines.length; cursor += 1) {
        if (lines[cursor].includes("」")) {
          quoteEndIndex = cursor;
          break;
        }
      }
      if (quoteEndIndex !== -1 && quoteEndIndex + 1 < lines.length && QUOTE_SEPARATOR.test(lines[quoteEndIndex + 1].trim())) {
        const quoteLines = [];
        for (let cursor = index; cursor <= quoteEndIndex; cursor += 1) {
          let quoteLine = lines[cursor].trim();
          if (cursor === index) quoteLine = quoteLine.replace(/^「/, "");
          if (cursor === quoteEndIndex) quoteLine = quoteLine.replace(/」$/, "");
          if (quoteLine) quoteLines.push(quoteLine);
        }
        if (quoteLines.length > 0) {
          const firstQuote = quoteLines[0];
          const colonMatch = firstQuote.match(/^([^：:]+)[：:](.*)$/);
          if (colonMatch) {
            rendered.push(`> **${escapeMarkdownText(colonMatch[1].trim())}**：${renderTextMessage(colonMatch[2].trim())}`);
            for (let cursor = 1; cursor < quoteLines.length; cursor += 1) {
              rendered.push(`> ${renderTextMessage(quoteLines[cursor])}`);
            }
          } else {
            for (const q of quoteLines) {
              rendered.push(`> ${renderTextMessage(q)}`);
            }
          }
        }
        index = quoteEndIndex + 2;
        continue;
      }
    }

    const mediaMatch = MEDIA_LINE.exec(trimmed);
    if (mediaMatch) {
      const item = mediaByName.get(basename(mediaMatch[2]));
      if (item) {
        item.used = true;
        rendered.push(mediaMarkdown(item));
        index += 1;
        continue;
      }
    }

    const link = parseLink(trimmed);
    if (link) {
      rendered.push(`[${escapeMarkdownText(link.title)}](${link.url})`);
      index += 1;
      continue;
    }

    if (trimmed) {
      rendered.push(renderTextMessage(trimmed));
    }
    index += 1;
  }

  return rendered.join("\n\n");
};

const parseTimeMs = (timeStr) => {
  const match = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr?.trim() || "");
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), ss ? Number(ss) : 0).getTime();
};

const groupMessages = (messages) => {
  const groups = [];
  for (const message of messages) {
    if (message.raw) {
      groups.push(message);
      continue;
    }
    const prev = groups.at(-1);
    if (prev && !prev.raw && prev.sender === message.sender) {
      const prevMs = parseTimeMs(prev.time);
      const currMs = parseTimeMs(message.time);
      const isClose = (prevMs !== null && currMs !== null && Math.abs(currMs - prevMs) <= 3 * 60 * 1000)
        || prev.time === message.time;
      if (isClose) {
        prev.body.push(...message.body);
        continue;
      }
    }
    groups.push({
      sender: message.sender,
      time: message.time,
      body: [...message.body],
    });
  }
  return groups;
};

const formatHeader = (sender, time, state) => {
  const match = /^(\d{4}年\d{1,2}月\d{1,2}日)\s+(\d{1,2}:\d{2})(?::\d{2})?$/.exec(time?.trim() || "");
  if (!match) {
    return `**${escapeMarkdownText(sender)}** · ${escapeMarkdownText(time)}`;
  }
  const [, date, clock] = match;
  if (state.lastDate === date) {
    return `**${escapeMarkdownText(sender)}** · ${clock}`;
  }
  state.lastDate = date;
  return `**${escapeMarkdownText(sender)}** · ${date} ${clock}`;
};

const titleTimestamp = (time) => {
  const match = /^(\d{4})年(\d{1,2})月(\d{1,2})日 (\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time || "");
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day) || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}`;
};

const archiveTitle = (archiveName, messages) => {
  const base = basename(archiveName || "").replace(/\.(?:zip|txt)$/i, "").trim();
  if (!base || base === "聊天记录") {
    const timestamp = titleTimestamp(messages.find((message) => message.time)?.time);
    if (timestamp) return `聊天记录 · ${timestamp}`;
  }
  return base || "聊天记录";
};

/**
 * @template T
 * @param {string} text
 * @param {string} archiveName
 * @param {{name: string, data: T}[]} mediaEntries
 * @returns {{title: string, markdown: string, media: {id: string, filename: string, mimeType: string, data: T}[]} | null}
 */
const renderWeChatChat = (text, archiveName, mediaEntries) => {
  const mediaByName = new Map();
  const ranked = [...mediaEntries].sort((left, right) => {
    const leftPreferred = left.name.startsWith(PREFERRED_MEDIA_DIRECTORY) ? 1 : 0;
    const rightPreferred = right.name.startsWith(PREFERRED_MEDIA_DIRECTORY) ? 1 : 0;
    return leftPreferred - rightPreferred;
  });
  const items = [];
  for (const entry of ranked) {
    const filename = basename(entry.name);
    const existing = mediaByName.get(filename);
    const item = existing ?? {
      id: `m${items.length + 1}`,
      filename,
      mimeType: mimeTypeFor(filename),
      data: entry.data,
      used: false,
    };
    if (!existing) items.push(item);
    else item.data = entry.data;
    mediaByName.set(filename, item);
  }

  const messages = parseMessages(text);
  const grouped = groupMessages(messages);
  const dateState = { lastDate: null };
  const sections = grouped.length > 0
    ? grouped.map((message) => {
      if (message.raw) return renderBody(message.raw, mediaByName);
      const body = renderBody(message.body, mediaByName);
      const header = formatHeader(message.sender, message.time, dateState);
      return body ? `${header}\n\n${body}` : header;
    })
    : [escapeMarkdownText(text.trim())];
  const unused = items.filter((item) => !item.used).map((item) => mediaMarkdown(item));
  const markdown = [...sections, ...unused].filter(Boolean).join("\n\n").trim();
  if (!markdown) return null;
  return {
    title: archiveTitle(archiveName, messages),
    markdown,
    media: items.map(({ id, filename, mimeType, data }) => ({
      id,
      filename,
      mimeType,
      data,
    })),
  };
};

// This formatter is also evaluated in the iOS app's isolated JavaScriptCore context.
exports.WECHAT_TRANSCRIPT_NAME = WECHAT_TRANSCRIPT_NAME;
exports.isWeChatChatFile = isWeChatChatFile;
exports.renderWeChatChat = renderWeChatChat;
