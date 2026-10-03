export const SELECTION_AI_SEND_LIMIT = 2000;

export const SELECTION_AI_LANGUAGES = ["zh-CN", "en", "ja"] as const;

export type SelectionAiLanguage = (typeof SELECTION_AI_LANGUAGES)[number];

export type SelectionAiKind = "explain" | "translate" | "ask";

export type SelectionAiMode = "rich" | "markdown";

export type SelectionAiPin = {
  memoId: string;
  text: string;
  sentText: string;
  displayText: string;
  truncated: boolean;
  from: number;
  to: number;
  isInline: boolean;
  documentFingerprint: string;
  mode: SelectionAiMode;
};

export type SelectionAiRequest = {
  id: string;
  kind: SelectionAiKind;
};

// The companion schema counts UTF-16 code units. Stop one unit early when a
// slice would cut a surrogate pair in half.
export const clipSelectionForSend = (text: string) => {
  if (text.length <= SELECTION_AI_SEND_LIMIT) {
    return { sentText: text, truncated: false };
  }
  let end = SELECTION_AI_SEND_LIMIT;
  const tail = text.charCodeAt(end - 1);
  if (tail >= 0xd800 && tail <= 0xdbff) end -= 1;
  return { sentText: text.slice(0, end), truncated: true };
};

export const translationReplacement = (response: string) => response.trim();

export const selectionAiUserMessage = ({
  instruction,
  notice,
  quote,
}: {
  instruction: string;
  notice?: string;
  quote: string;
}) => [instruction.trim(), notice?.trim(), quote].filter((part) => part && part.length > 0).join("\n\n");
