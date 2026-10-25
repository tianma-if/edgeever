import type { CompanionTurnInput } from "./companion";

type ExplicitDiagramKind = "mind-map" | "flowchart" | "architecture";

const EXPLICIT_DIAGRAM_KIND_PATTERNS: Array<[ExplicitDiagramKind, RegExp]> = [
  ["mind-map", /(?:思维导图|思維導圖|心智图|心智圖|腦圖|mind[ -]?map|マインドマップ)/iu],
  ["flowchart", /(?:流程图|流程圖|flow[ -]?chart|フローチャート)/iu],
  ["architecture", /(?:架构图|架構圖|architectur(?:e|al)[ -]?diagram|アーキテクチャ図)/iu],
];

// Deictic references to the note open in the editor. A shared topic word is not one of these.
const OPEN_NOTE_REFERENCE = /(?:这篇|此篇|本文|本篇|这条笔记|这个笔记|这份笔记|上述|当前|上面|这[张个幅]图|这张流程|这张导图|打开的笔记|正在看的|笔记里|图里|根据这篇|基于这篇|照着这|this note|this diagram|this flowchart|this mind[- ]?map|the open note|current note|current diagram|このノート|この図|このフロー|このマインドマップ|現在のノート|このメモ|ta notatk[aę]|tej notatki|bieżącej notatki|bieżąca notatka)/iu;

const DIAGRAM_KIND_SOURCE = EXPLICIT_DIAGRAM_KIND_PATTERNS.map(([, pattern]) => pattern.source).join("|");
const OWN_SUBJECT_BEFORE = new RegExp(
  `(?:生成|新建|创建|绘制|画|做|写|制作|create|draw|make|generate)(?:一[个张份])?(?:关于|有关|围绕)?([^，。,.!！?？\\n]{0,40}?)(?:的)?(?:${DIAGRAM_KIND_SOURCE})`,
  "iu",
);
const OWN_SUBJECT_AFTER = new RegExp(
  `(?:${DIAGRAM_KIND_SOURCE})(?:\\s*[，,]?\\s*)?(?:关于|有关|主题是|主题为|来介绍|用来介绍|介绍一下|about|of|on|for)\\s*([^，。,.!！?？\\n]{1,40})`,
  "iu",
);
// 整理成 / 画成 / 做成 keep the open note. They are not a separately named subject.
const OPERATE_ON_OPEN_NOTE = new RegExp(
  `(?:整理|转换|转|画|做|总结|归纳|提炼|换成|变成)成\\s*(?:一[个张份])?\\s*(?:${DIAGRAM_KIND_SOURCE})`,
  "iu",
);
const LEADING_FILLER = /^(?:帮我|请|给我|一下|一个|一张|一份|关于|有关|围绕|的|把|将|a|an|the)\s*/iu;
const TRAILING_FILLER = /(?:的|一下|笔记|note)\s*$/iu;
const DEICTIC_TOPIC = /^(?:这个|这篇|此篇|本文|本篇|当前|上面|它|这张|这张图|这个图|内容|这些|该图|该笔记|笔记内容|this|it|that)$/iu;

export const INDEPENDENT_DIAGRAM_FOCUS_NOTE = "The user named a separate diagram subject and did not refer to the note open in the editor. Do not call get_memo or get_diagram on it. Do not reuse its title or structure. Build the diagram only from this request.";

export const OPEN_NOTE_DIAGRAM_FOCUS_NOTE = "The user asked for a diagram of the open note, or did not name a separate subject. Build it from that note. If its body is not included below, call get_memo, or get_diagram when the open note is a diagram.";

export type OpenNoteFocusInput = {
  message: string;
  focus?: Pick<NonNullable<CompanionTurnInput["focus"]>, "memoId" | "contentMarkdown" | "selectionMarkdown"> | null;
  mentions?: ReadonlyArray<{ type: string; id: string }>;
};

export const explicitDiagramKind = (message: string): ExplicitDiagramKind | undefined => {
  const matches = EXPLICIT_DIAGRAM_KIND_PATTERNS.filter(([, pattern]) => pattern.test(message));
  return matches.length === 1 ? matches[0][0] : undefined;
};

export const messageRefersToOpenNote = (message: string) => OPEN_NOTE_REFERENCE.test(message);

const substantiveTopic = (value: string | undefined) => {
  let topic = (value ?? "").trim();
  for (let i = 0; i < 6 && topic; i += 1) {
    const next = topic.replace(LEADING_FILLER, "").replace(TRAILING_FILLER, "").trim();
    if (next === topic) break;
    topic = next;
  }
  if (!topic || DEICTIC_TOPIC.test(topic)) return "";
  return topic;
};

// True only when the user names a subject of their own, such as 「一个 AI 大模型的思维导图」.
// 「生成思维导图」 or 「整理成思维导图」 has no separate subject, so the open note stays in scope.
export const diagramRequestHasOwnSubject = (message: string) => {
  if (!explicitDiagramKind(message) || messageRefersToOpenNote(message) || OPERATE_ON_OPEN_NOTE.test(message)) return false;
  const before = substantiveTopic(message.match(OWN_SUBJECT_BEFORE)?.[1]);
  const after = substantiveTopic(message.match(OWN_SUBJECT_AFTER)?.[1]);
  return Boolean(before || after);
};

export const openNoteContentAttached = (input: OpenNoteFocusInput) => {
  const focus = input.focus;
  if (!focus?.memoId) return false;
  if (focus.contentMarkdown?.trim() || focus.selectionMarkdown?.trim()) return true;
  return (input.mentions ?? []).some(mention => mention.type === "memo" && mention.id === focus.memoId);
};

export const independentDiagramRequest = (input: OpenNoteFocusInput) =>
  Boolean(input.focus?.memoId)
  && diagramRequestHasOwnSubject(input.message)
  && !openNoteContentAttached(input);
