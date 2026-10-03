import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ArrowUp, Check, ChevronDown, Download, FileText, Loader2, PanelRightClose, Plus, Search, Sparkles, X } from "lucide-react";
import type { CompanionAction, CompanionAnswer, CompanionEvent, CompanionTurn, CompanionTurnInput } from "@edgeever/shared";
import { buildRevisionDiffRows, createMemoLinkHref } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Image } from "@/components/ai-elements/image";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { api, ApiRequestError } from "@/lib/api";
import { sidebarCompanionFocus, sidebarLocalContextText } from "@/lib/ai-sidebar-context";
import { copyTextToClipboard } from "@/lib/clipboard";
import { createClientUuid } from "@/lib/client-id";
import {
  AI_ATTACHMENT_ACCEPT,
  AiAttachmentError,
  formatAiAttachmentSize,
  prepareAiAttachments,
  type PreparedAiAttachment,
} from "@/lib/ai-attachments";
import { companionLocale } from "@/lib/companion-locale";
import {
  AI_SIDEBAR_LOCAL_THREAD_KEY,
  AI_SIDEBAR_LOCAL_THREADS_KEY,
  AI_SIDEBAR_OPEN_KEY,
  AI_SIDEBAR_THREAD_KEY,
  AI_SIDEBAR_WIDTH_KEY,
  cancelDesktopAcp,
  promptDesktopAcp,
  readAiSidebarAdapter,
  readAiSidebarSource,
  subscribeDesktopAcp,
  type DesktopAcpEvent,
} from "@/lib/desktop-acp";
import {
  chatThreadsFromTurns,
  localAgentTranscript,
  parseLocalAgentTurns,
  resolveLocalAgentThreadId,
  saveLocalAgentTurns,
  type ChatThreadSummary,
} from "@/lib/local-agent-threads";
import { LocalAgentImageStore } from "@/lib/local-agent-images";
import { sidebarRevealTransition } from "@/lib/motion";
import {
  SELECTION_AI_LANGUAGES,
  selectionAiUserMessage,
  translationReplacement,
  type SelectionAiLanguage,
  type SelectionAiPin,
  type SelectionAiRequest,
} from "@/lib/selection-ai";
import { cn } from "@/lib/utils";
import { CompanionQuestionForm } from "../CompanionQuestionForm";
import { AiSidebarMessage } from "./AiSidebarMessage";
import { AiSidebarLocalProcess } from "./AiSidebarLocalProcess";
import { BuiltinAgentStatus } from "./BuiltinAgentStatus";
import { InfographicSidebarSession, type InfographicSidebarController } from "./InfographicSidebarSession";
import { memoIdFromSidebarLinkEvent } from "./sidebar-note-links";

const SIDEBAR_DEFAULT_WIDTH = 380;
const sidebarThreadClassName = cn(
  "gap-3 p-3 text-[13px] leading-[1.6]",
  "[&_[data-streamdown=heading-1]]:mt-3 [&_[data-streamdown=heading-1]]:mb-1 [&_[data-streamdown=heading-1]]:text-[15px] [&_[data-streamdown=heading-1]]:leading-snug",
  "[&_[data-streamdown=heading-2]]:mt-3 [&_[data-streamdown=heading-2]]:mb-1 [&_[data-streamdown=heading-2]]:text-[15px] [&_[data-streamdown=heading-2]]:leading-snug",
  "[&_[data-streamdown=heading-3]]:mt-2.5 [&_[data-streamdown=heading-3]]:mb-1 [&_[data-streamdown=heading-3]]:text-sm [&_[data-streamdown=heading-3]]:leading-snug",
  "[&_[data-streamdown=heading-4]]:mt-2 [&_[data-streamdown=heading-4]]:mb-1 [&_[data-streamdown=heading-4]]:text-[13px]",
  "[&_[data-streamdown=heading-5]]:mt-2 [&_[data-streamdown=heading-5]]:mb-1 [&_[data-streamdown=heading-5]]:text-[13px]",
  "[&_[data-streamdown=heading-6]]:mt-2 [&_[data-streamdown=heading-6]]:mb-1 [&_[data-streamdown=heading-6]]:text-xs",
  "[&_[data-streamdown=list-item]]:py-0.5",
  "[&_[data-streamdown=blockquote]]:my-2",
  "[&_[data-streamdown=inline-code]]:text-[12px]",
  "[&_[data-streamdown=code-block-body]]:text-[12px] [&_[data-streamdown=code-block-body]]:leading-[1.55]",
  "[&_[data-streamdown=code-block-body]_span]:before:text-[12px]",
);
const sidebarUserMessageClassName = "whitespace-pre-wrap break-words text-[13px] leading-5 group-[.is-user]:px-3 group-[.is-user]:py-2";
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const NARROW_QUERY = "(max-width: 767px)";

const SKILLS = [
  { id: "summarize", command: "/summarize" },
  { id: "improve", command: "/improve" },
  { id: "translate", command: "/translate" },
] as const;

type SkillId = (typeof SKILLS)[number]["id"];

type PendingAttachment = PreparedAiAttachment & {
  localId: string;
  previewUrl: string | null;
};

type LocalToolRow = { id: string; name: string; status: string; title?: string };

type LocalImage = { id: string; mediaType: string; base64: string };

const EMPTY_IMAGE_BYTES = new Uint8Array();
const MAX_LOCAL_IMAGES = 8;
const localAgentImageStore = new LocalAgentImageStore();

type LocalTurn = {
  id: string;
  threadId: string;
  message: string;
  response: string;
  reasoning: string;
  tools: LocalToolRow[];
  images: LocalImage[];
  attachments: Array<{ id: string; filename: string; mediaType: string; byteLength: number }>;
  status: "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
};

type ActiveTurn = {
  id: string;
  kind: "companion" | "acp";
  controller: AbortController;
  requestId?: string;
  started: boolean;
};

type UploadedCompanionAttachment = {
  id: string;
  filename: string;
  mediaType: string;
  byteLength: number;
  expiresAt: string;
};

export type AiSidebarFocus = {
  memoId?: string;
  notebookId?: string;
  notebookTitle?: string;
  noteTitle?: string;
  selectionMarkdown?: string;
  contentMarkdown?: string;
};

type AiSidebarProps = AiSidebarFocus & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companionAvailable: boolean;
  selectionPin?: SelectionAiPin | null;
  selectionRequest?: SelectionAiRequest | null;
  onDismissSelectionPin?: () => void;
  onReplaceSelection?: (replacement: string) => boolean;
  beforeCompanionApply?: () => Promise<void>;
  onCompanionNotesChanged?: () => Promise<void>;
  onOpenCompanionNote?: (id: string, notebookId: string) => void;
  infographic?: InfographicSidebarController | null;
};

const SELECTION_TURN_STORAGE = "edgeever.aiSidebar.selectionTurns";

const readSelectionTurnKinds = (): Record<string, "explain" | "translate"> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(SELECTION_TURN_STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, "explain" | "translate"> = {};
    for (const [id, kind] of Object.entries(parsed)) {
      if (kind === "explain" || kind === "translate") next[id] = kind;
    }
    return next;
  } catch {
    return {};
  }
};

const clampSidebarWidth = (value: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));

const readStorage = (key: string) => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference storage can be unavailable in private mode.
  }
};

export const readAiSidebarOpen = () => readStorage(AI_SIDEBAR_OPEN_KEY) === "true";

export const writeAiSidebarOpen = (open: boolean) => {
  writeStorage(AI_SIDEBAR_OPEN_KEY, open ? "true" : "false");
};

export const readAiSidebarWidth = () => {
  const raw = readStorage(AI_SIDEBAR_WIDTH_KEY);
  if (!raw?.trim()) return SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
};

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const THREAD_RECENCY_MS = 30 * 24 * 60 * 60 * 1000;

const readAiSidebarThread = () => {
  const value = readStorage(AI_SIDEBAR_THREAD_KEY);
  return value && THREAD_ID_PATTERN.test(value) ? value : null;
};

const writeAiSidebarThread = (threadId: string) => {
  writeStorage(AI_SIDEBAR_THREAD_KEY, threadId);
};

const sidebarThreadLabel = (title: string) => {
  const clause = title.split(/[，。！？!?；;：:\n]/)[0]?.trim() || title;
  return clause.length >= 2 ? clause : title;
};

function AiSidebarThreadMenu({
  threads,
  threadId,
  title,
  onSelect,
  onCreate,
}: {
  threads: ChatThreadSummary[];
  threadId: string;
  title: string;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = threads.filter((thread) => !normalized || thread.title.toLocaleLowerCase().includes(normalized));
  const cutoff = Date.now() - THREAD_RECENCY_MS;
  const recent = visible.filter((thread) => Date.parse(thread.updatedAt) >= cutoff);
  const older = visible.filter((thread) => Date.parse(thread.updatedAt) < cutoff);
  const searchOnRecent = recent.length > 0 || older.length === 0;

  const renderGroup = (label: string, items: ChatThreadSummary[], withSearch: boolean) => {
    if (!items.length) return null;
    return (
      <div>
        {searching ? null : (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-500">
            <span className="min-w-0 flex-1">{label}</span>
            {withSearch ? (
              <button
                type="button"
                className="rounded-sm p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={t("aiAssistant.sidebar.historySearch")}
                onClick={() => setSearching(true)}
              >
                <Search className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )}
        {items.map((thread) => (
          <DropdownMenuItem
            key={thread.id}
            className="justify-between gap-3 py-2 text-sm"
            onSelect={() => onSelect(thread.id)}
          >
            <span className="truncate">{thread.title}</span>
            {thread.id === threadId ? <Check className="size-4 shrink-0 text-slate-700" aria-hidden="true" /> : <span className="size-4 shrink-0" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </div>
    );
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) { setQuery(""); setSearching(false); } }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 max-w-52 items-center gap-1 rounded-full px-2 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          data-ai-thread-menu=""
          aria-label={`${title} · ${t("aiAssistant.sidebar.history")}`}
        >
          <Sparkles className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span className="min-w-0 truncate">{sidebarThreadLabel(title)}</span>
          <ChevronDown className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[60] max-h-80 w-72 overflow-y-auto p-1.5">
        {searching ? (
          <input
            autoFocus
            value={query}
            placeholder={t("aiAssistant.sidebar.historySearch")}
            className="mb-1 h-8 w-full rounded-md border border-slate-200 bg-card px-2 text-sm text-slate-950 outline-none placeholder:text-slate-400"
            aria-label={t("aiAssistant.sidebar.historySearch")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        ) : null}
        <DropdownMenuItem className="gap-2 py-2 text-sm" onSelect={onCreate}>
          <Plus className="size-3.5 shrink-0" aria-hidden="true" />
          {t("aiAssistant.sidebar.newThread")}
        </DropdownMenuItem>
        {threads.length ? <DropdownMenuSeparator /> : null}
        {renderGroup(t("aiAssistant.sidebar.historyRecent"), recent, searchOnRecent && !searching)}
        {renderGroup(t("aiAssistant.sidebar.historyOlder"), older, !searchOnRecent && !searching)}
        {normalized && !visible.length ? (
          <p className="px-2 py-3 text-sm text-slate-500">{t("aiAssistant.sidebar.historyEmpty")}</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const readLocalAdapter = readAiSidebarAdapter;

const attachmentServerCode = (code: string | undefined) => (
  code === "companion_attachment_unsupported" || code === "companion_attachment_expired" ? code : null
);

const isAbortError = (cause: unknown) => cause instanceof DOMException
  ? cause.name === "AbortError"
  : cause instanceof Error && cause.name === "AbortError";

const noteEditDraft = (action: CompanionAction) => {
  if (action.plan.kind !== "tool" || action.plan.toolName !== "update_memo") return null;
  const after = action.plan.arguments.contentMarkdown;
  const before = action.preview?.baseContentMarkdown;
  if (typeof after !== "string" || typeof before !== "string") return null;
  return { before, after };
};

const emptyCompanionTurn = (
  partial: Pick<CompanionTurn, "id" | "threadId" | "message"> & { attachments?: CompanionTurn["attachments"] },
): CompanionTurn => ({
  ...partial,
  response: "",
  process: "",
  status: "running",
  sources: [],
  tools: [],
  todos: [],
  questions: [],
  mentions: [],
  model: "",
  inputTokens: null,
  outputTokens: null,
  createdAt: new Date().toISOString(),
});

const uploadCompanionAttachment = (attachment: { filename: string; mediaType: string; base64Data: string }) => {
  const client = api as typeof api & {
    uploadCompanionAttachment: (input: { filename: string; mediaType: string; base64Data: string }) => Promise<{ attachment: UploadedCompanionAttachment }>;
  };
  return client.uploadCompanionAttachment(attachment);
};

const matchSkill = (text: string) => {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const skill = SKILLS.find((item) => lower === item.command || lower.startsWith(`${item.command} `));
  if (!skill) return null;
  return { id: skill.id, rest: trimmed.slice(skill.command.length).trim() };
};

const mergeReasoning = (previous: string, next: string) => {
  if (!next) return previous;
  if (!previous || next.startsWith(previous)) return next;
  if (previous.endsWith(next)) return previous;
  return previous + next;
};

const linkedCompanionText = (text: string, turn: CompanionTurn) => text.replace(/\[note:([^\]]+)\]/g, (_match, id: string) => {
  const source = turn.sources.find((item) => item.id === id);
  const label = (source?.title || id).replace(/[[\]]/g, "");
  return `[${label}](${createMemoLinkHref(id)})`;
});

const attachmentFileData = (attachment: { id: string; filename: string; mediaType: string; url?: string }) => ({
  id: attachment.id,
  type: "file" as const,
  url: attachment.url ?? "",
  filename: attachment.filename,
  mediaType: attachment.mediaType,
});

function AttachmentChips({
  items,
  onRemove,
}: {
  items: Array<{ id: string; filename: string; mediaType: string; byteLength?: number; url?: string }>;
  onRemove?: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <Attachments variant="inline" className="ml-0 w-full">
      {items.map((item) => (
        <Attachment
          key={item.id}
          data={attachmentFileData(item)}
          onRemove={onRemove ? () => onRemove(item.id) : undefined}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          {typeof item.byteLength === "number" ? (
            <span className="shrink-0 text-xs text-slate-400">{formatAiAttachmentSize(item.byteLength)}</span>
          ) : null}
          <AttachmentRemove label={t("aiAssistant.removeAttachment", { name: item.filename })} />
        </Attachment>
      ))}
    </Attachments>
  );
}

function NoteEditDiff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => buildRevisionDiffRows(before, after), [before, after]);
  return (
    <div className="max-h-52 overflow-auto rounded-md border border-slate-200 bg-card">
      {rows.leftRows.map((left, index) => {
        const right = rows.rightRows[index];
        return (
          <div key={`${left.lineNumber ?? "l"}-${index}`} className="grid grid-cols-2 divide-x divide-slate-200 font-mono text-[11px] leading-4">
            <div className={cn(
              "whitespace-pre-wrap break-words px-1.5 py-0.5",
              left.state === "changed" && "bg-rose-50 text-rose-950",
              left.state === "empty" && "bg-slate-50 text-transparent",
              left.state === "same" && "text-slate-600",
            )}>{left.text || " "}</div>
            <div className={cn(
              "whitespace-pre-wrap break-words px-1.5 py-0.5",
              right?.state === "changed" && "bg-slate-100 text-slate-950",
              right?.state === "empty" && "bg-slate-50 text-transparent",
              right?.state === "same" && "text-slate-600",
            )}>{right?.text || " "}</div>
          </div>
        );
      })}
    </div>
  );
}

function SelectionReplyActions({
  kind,
  response,
  pinned,
  busy,
  onReplace,
  onRetranslate,
}: {
  kind: "explain" | "translate";
  response: string;
  pinned: boolean;
  busy: boolean;
  onReplace: (replacement: string) => boolean;
  onRetranslate: (language: SelectionAiLanguage) => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [stale, setStale] = useState(false);
  const copyText = kind === "translate" ? translationReplacement(response) : response.trim();
  if (!copyText) return null;
  return (
    <div className="space-y-1.5" data-selection-reply-actions={kind}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void copyTextToClipboard(copyText).then((ok) => {
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? t("aiAssistant.sidebar.selection.copied") : t("aiAssistant.sidebar.selection.copy")}
        </Button>
        {kind === "translate" && pinned ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (onReplace(response)) {
                setStale(false);
                return;
              }
              setStale(true);
            }}
          >
            {t("aiAssistant.sidebar.selection.replace")}
          </Button>
        ) : null}
        {kind === "translate" && pinned ? SELECTION_AI_LANGUAGES.map((language) => (
          <Button
            key={language}
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onRetranslate(language)}
          >
            {t(`aiAssistant.sidebar.selection.chips.${language}`)}
          </Button>
        )) : null}
      </div>
      {stale ? (
        <p role="alert" className="text-xs text-rose-700">{t("aiAssistant.sidebar.selection.stale")}</p>
      ) : null}
    </div>
  );
}

function SidebarComposer({
  attachments,
  attachmentError,
  busy,
  locked,
  placeholder,
  onAddFiles,
  onRemoveAttachment,
  onLaunch,
  includeCurrentNote,
  currentNoteAvailable,
  onIncludeCurrentNoteChange,
  onStop,
  skillPrompt,
  focusToken,
}: {
  attachments: PendingAttachment[];
  attachmentError: string | null;
  busy: boolean;
  locked: boolean;
  placeholder: string;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onLaunch: (message: string, options?: { includeCurrentNote?: boolean }) => Promise<string>;
  includeCurrentNote: boolean;
  currentNoteAvailable: boolean;
  onIncludeCurrentNoteChange: (include: boolean) => void;
  onStop: () => void;
  skillPrompt: (id: SkillId, rest?: string) => string;
  focusToken: number;
}) {
  const { t } = useTranslation();
  const { textInput } = usePromptInputController();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const focusedToken = useRef(0);
  useEffect(() => {
    if (!focusToken || busy || focusedToken.current === focusToken) return;
    const field = composerRef.current?.querySelector("textarea");
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.focus();
    focusedToken.current = focusToken;
  }, [busy, focusToken]);
  const draft = textInput.value;
  const token = draft.trimStart().split(/\s/, 1)[0]?.toLowerCase() ?? "";
  const slashOpen = token.startsWith("/") && !draft.trimStart().includes("\n");
  const slashMatches = slashOpen ? SKILLS.filter((skill) => skill.command.startsWith(token)) : [];

  const launch = async (message: string, restoreDraft?: string, forceCurrentNote = false) => {
    try {
      await onLaunch(message, forceCurrentNote ? { includeCurrentNote: true } : undefined);
      if (restoreDraft !== undefined) textInput.clear();
    } catch (cause) {
      if (restoreDraft !== undefined && !isAbortError(cause)) textInput.setInput(restoreDraft);
      throw cause;
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    onAddFiles(files);
  };

  return (
    <div ref={composerRef} className="space-y-2">
      {slashMatches.length ? (
        <ul className="overflow-hidden rounded-md border border-slate-200 bg-card text-sm">
          {slashMatches.map((skill) => (
            <li key={skill.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => void launch(skillPrompt(skill.id), draft, true).catch(() => undefined)}
              >
                <span className="font-medium text-slate-800">{t(`aiAssistant.sidebar.skills.${skill.id}`)}</span>
                <span className="truncate text-xs text-slate-400">{skill.command}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PromptInput
        accept={AI_ATTACHMENT_ACCEPT}
        inputGroupClassName="rounded-[22px] border-slate-200 bg-card shadow-sm has-[[data-slot=input-group-control]:focus-visible]:ring-0"
        multiple
        onSubmit={async ({ text }) => {
          const raw = text.trim();
          if (!raw) throw new Error("empty");
          const skill = matchSkill(raw);
          await launch(skill ? skillPrompt(skill.id, skill.rest) : raw, undefined, Boolean(skill));
        }}
      >
        {attachments.length ? (
          <PromptInputHeader>
            <AttachmentChips
              items={attachments.map((item) => ({
                id: item.localId,
                filename: item.filename,
                mediaType: item.mediaType,
                byteLength: item.byteLength,
                url: item.previewUrl ?? undefined,
              }))}
              onRemove={onRemoveAttachment}
            />
          </PromptInputHeader>
        ) : null}
        <PromptInputTextarea
          className="min-h-20 px-4 pb-2 pt-4 text-[13px] leading-5 placeholder:text-zinc-400/80 dark:placeholder:text-zinc-500 md:text-[13px]"
          disabled={busy || locked}
          placeholder={placeholder}
          onPaste={onPaste}
        />
        <PromptInputFooter className="px-2.5 pb-2.5 pt-0">
          <PromptInputTools>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    aria-label={t("aiAssistant.addAttachment")}
                    disabled={busy || locked}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("aiAssistant.addAttachment")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {currentNoteAvailable ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={includeCurrentNote}
                className={includeCurrentNote ? "border-slate-600 bg-slate-100 text-slate-900 hover:bg-slate-200" : undefined}
                disabled={busy || locked}
                onClick={() => onIncludeCurrentNoteChange(!includeCurrentNote)}
              >
                <FileText className="size-3.5" aria-hidden="true" />
                {t("aiAssistant.sidebar.includeCurrentNote")}
              </Button>
            ) : null}
          </PromptInputTools>
          {busy ? (
            <Button type="button" size="sm" variant="outline" onClick={onStop}>
              {t("aiAssistant.sidebar.stop")}
            </Button>
          ) : (
            <PromptInputSubmit
              aria-label={t("companion.send")}
              className="rounded-full border-slate-900 bg-slate-900 text-slate-50 hover:border-slate-800 hover:bg-slate-800 disabled:border-slate-100 disabled:bg-slate-100 disabled:text-slate-300"
              disabled={locked || !draft.trim()}
              variant="solid"
            >
              <ArrowUp className="size-4" />
            </PromptInputSubmit>
          )}
        </PromptInputFooter>
      </PromptInput>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        accept={AI_ATTACHMENT_ACCEPT}
        aria-label={t("aiAssistant.addAttachment")}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onAddFiles(files);
        }}
      />
      {attachmentError ? <p role="alert" className="text-xs font-medium text-rose-700">{attachmentError}</p> : null}
    </div>
  );
}

// The editor hides this session with CSS. Closing must not unmount it or abort a turn.
function AiSidebarSession({
  open,
  onOpenChange,
  companionAvailable,
  selectionMarkdown,
  selectionPin,
  selectionRequest,
  onDismissSelectionPin,
  onReplaceSelection,
  contentMarkdown,
  memoId,
  notebookId,
  notebookTitle,
  noteTitle,
  beforeCompanionApply,
  onCompanionNotesChanged,
  onOpenCompanionNote,
  addFilesRef,
  onStopReady,
}: AiSidebarProps & {
  addFilesRef: RefObject<(files: File[]) => void>;
  onStopReady: RefObject<() => void>;
}) {
  const { t, i18n } = useTranslation();
  const [source, setSource] = useState<"builtin" | "local">(readAiSidebarSource);
  const [localAdapterId, setLocalAdapterId] = useState(() => readLocalAdapter()?.id ?? null);
  const [turns, setTurns] = useState<CompanionTurn[]>([]);
  const [actions, setActions] = useState<CompanionAction[]>([]);
  const [localTurns, setLocalTurns] = useState<LocalTurn[]>(() => parseLocalAgentTurns(readStorage(AI_SIDEBAR_LOCAL_THREADS_KEY)).map((turn) => ({
    ...turn,
    images: [],
  })));
  const [localThreadId, setLocalThreadId] = useState(() => (
    resolveLocalAgentThreadId(
      readStorage(AI_SIDEBAR_LOCAL_THREAD_KEY),
      parseLocalAgentTurns(readStorage(AI_SIDEBAR_LOCAL_THREADS_KEY)),
    ) ?? createClientUuid()
  ));
  const [threadId, setThreadId] = useState<string>(() => readAiSidebarThread() ?? createClientUuid());
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useMemory, setUseMemory] = useState(false);
  const [includeCurrentNote, setIncludeCurrentNote] = useState(false);
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  const [selectionTurnKinds, setSelectionTurnKinds] = useState<Record<string, "explain" | "translate">>(readSelectionTurnKinds);
  const alive = useRef(true);
  const handledSelectionRequestId = useRef<string | null>(null);
  const locked = useRef(false);
  const threadPinned = useRef(false);
  const active = useRef<ActiveTurn | null>(null);
  const attachmentSnapshot = useRef<PendingAttachment[]>([]);
  const acpTurnIds = useRef(new Map<string, string>());
  const acpBuffer = useRef<DesktopAcpEvent[]>([]);
  const localTurnsRef = useRef(localTurns);
  const localThreadIdRef = useRef(localThreadId);
  const localPersistTimer = useRef<number | null>(null);
  const imagesByTurn = useRef(new Map<string, Map<string, LocalImage>>());
  localTurnsRef.current = localTurns;
  localThreadIdRef.current = localThreadId;
  const focusRef = useRef({ selectionMarkdown, contentMarkdown, memoId, notebookId, notebookTitle, noteTitle, companionAvailable });
  focusRef.current = { selectionMarkdown, contentMarkdown, memoId, notebookId, notebookTitle, noteTitle, companionAvailable };

  useEffect(() => {
    setIncludeCurrentNote(false);
  }, [memoId]);

  const explainError = useCallback((cause: unknown) => {
    const code = cause instanceof ApiRequestError ? cause.code : "";
    if (code === "companion_attachment_unsupported") return t("aiAssistant.sidebar.attachmentUnsupported");
    if (code === "companion_attachment_expired") return t("aiAssistant.sidebar.attachmentExpired");
    if (code === "ai_not_configured") return t("companion.configureModel");
    if (code === "ai_credentials_rejected") return t("companion.credentialsRejected");
    if (code === "ai_provider_payment_required") return t("companion.providerPaymentRequired");
    if (code === "ai_provider_rate_limited") return t("companion.providerRateLimited");
    if (code === "ai_provider_request_rejected") return t("companion.providerRequestRejected");
    if (code === "companion_memory_conflict") return t("companion.conflict");
    if (code === "companion_history_full") return t("companion.historyFull");
    if (code === "companion_action_conflict") return t("aiAssistant.sidebar.proposalConflict");
    if (code === "companion_action_unsynced") return t("companion.actions.unsynced");
    if (code === "companion_busy") return t("companion.recovered");
    if (cause instanceof ApiRequestError && cause.status === 403) return t("aiAssistant.sidebar.unavailable");
    return t("companion.failed");
  }, [t]);

  const restoreAttachments = useCallback((snapshot: PendingAttachment[]) => {
    setAttachments((current) => current.length > 0 ? current : snapshot);
  }, []);

  const reloadCompanion = useCallback(async () => {
    const [turnResult, actionResult] = await Promise.all([
      api.listCompanionTurns(),
      api.listCompanionActions(),
    ]);
    if (!alive.current) return;
    setTurns(turnResult.turns);
    setActions(actionResult.actions);
    setThreadId((current) => {
      if (threadPinned.current) return current;
      const stored = readAiSidebarThread();
      const ids = new Set(turnResult.turns.map((turn) => turn.threadId));
      if (stored && ids.has(stored)) return stored;
      return turnResult.turns[0]?.threadId ?? current;
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const current = active.current;
      current?.controller.abort();
      if (current?.kind === "acp" && current.requestId) void cancelDesktopAcp(current.requestId).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const turnIds = localTurnsRef.current.map((turn) => turn.id);
    if (!turnIds.length) return;
    void localAgentImageStore.list(turnIds).then((images) => {
      if (!alive.current || !images.length) return;
      const byTurn = new Map<string, LocalImage[]>();
      for (const image of images) {
        const list = byTurn.get(image.turnId) ?? [];
        if (list.length < MAX_LOCAL_IMAGES) list.push({ id: image.id, mediaType: image.mediaType, base64: image.base64 });
        byTurn.set(image.turnId, list);
      }
      setLocalTurns((previous) => previous.map((turn) => {
        const saved = byTurn.get(turn.id);
        if (!saved?.length) return turn;
        const currentIds = new Set(turn.images.map((image) => image.id));
        const restored = [...turn.images, ...saved.filter((image) => !currentIds.has(image.id))].slice(0, MAX_LOCAL_IMAGES);
        return { ...turn, images: restored };
      }));
    }).catch(() => {
      if (alive.current) setError(t("aiAssistant.sidebar.imageSaveFailed"));
    });
  }, [t]);

  useEffect(() => {
    if (!localTurns.length && !readStorage(AI_SIDEBAR_LOCAL_THREADS_KEY)) return;
    if (localPersistTimer.current != null) window.clearTimeout(localPersistTimer.current);
    localPersistTimer.current = window.setTimeout(() => {
      try {
        const saved = saveLocalAgentTurns(window.localStorage, AI_SIDEBAR_LOCAL_THREADS_KEY, localTurnsRef.current);
        if (saved) void localAgentImageStore.prune(saved.map((turn) => turn.id)).catch(() => undefined);
      } catch {
        // Private mode can reject storage writes. The open chat still stays in memory.
      }
    }, 400);
    return () => {
      if (localPersistTimer.current != null) window.clearTimeout(localPersistTimer.current);
    };
  }, [localTurns]);

  useEffect(() => {
    const flush = () => {
      if (localPersistTimer.current != null) window.clearTimeout(localPersistTimer.current);
      if (!localTurnsRef.current.length && !readStorage(AI_SIDEBAR_LOCAL_THREADS_KEY)) return;
      try {
        const saved = saveLocalAgentTurns(window.localStorage, AI_SIDEBAR_LOCAL_THREADS_KEY, localTurnsRef.current);
        if (saved) void localAgentImageStore.prune(saved.map((turn) => turn.id)).catch(() => undefined);
      } catch {
        // The in-memory chat remains available until the page closes.
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const applyAcpEventRef = useRef<(event: DesktopAcpEvent) => void>(() => undefined);
  useEffect(() => subscribeDesktopAcp((event) => {
    if (!acpTurnIds.current.has(event.requestId)) {
      acpBuffer.current.push(event);
      return;
    }
    applyAcpEventRef.current(event);
  }), []);

  applyAcpEventRef.current = (event) => {
    const turnId = acpTurnIds.current.get(event.requestId);
    if (!turnId || !alive.current) return;
    if (event.type === "text-delta") {
      setLocalTurns((previous) => previous.map((turn) => turn.id === turnId && turn.status !== "cancelled"
        ? { ...turn, response: turn.response + event.text }
        : turn));
      return;
    }
    if (event.type === "reasoning") {
      setLocalTurns((previous) => previous.map((turn) => turn.id === turnId && turn.status !== "cancelled"
        ? { ...turn, reasoning: mergeReasoning(turn.reasoning, event.text) }
        : turn));
      return;
    }
    if (event.type === "tool") {
      setLocalTurns((previous) => previous.map((turn) => {
        if (turn.id !== turnId || turn.status === "cancelled") return turn;
        const row = { id: createClientUuid(), name: event.name, status: event.status, title: event.title };
        let index = -1;
        for (let toolIndex = turn.tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
          const item = turn.tools[toolIndex];
          if (item.name === event.name && item.title === event.title && item.status !== "done") {
            index = toolIndex;
            break;
          }
        }
        if (index < 0) return { ...turn, tools: [...turn.tools, row] };
        const tools = turn.tools.slice();
        tools[index] = { ...tools[index], status: event.status, title: event.title };
        return { ...turn, tools };
      }));
      return;
    }
    if (event.type === "image") {
      const current = localTurnsRef.current.find((turn) => turn.id === turnId);
      if (current?.status === "cancelled") return;
      const known = imagesByTurn.current.get(turnId) ?? new Map(current?.images.map((image) => [image.id, image]) ?? []);
      if ([...known.values()].some((image) => image.id !== event.id && image.mediaType === event.mediaType && image.base64 === event.base64)) return;
      if (!known.has(event.id) && known.size >= MAX_LOCAL_IMAGES) return;
      known.set(event.id, { id: event.id, mediaType: event.mediaType, base64: event.base64 });
      imagesByTurn.current.set(turnId, known);
      void localAgentImageStore.put({ turnId, id: event.id, mediaType: event.mediaType, base64: event.base64 }).catch(() => {
        if (alive.current) setError(t("aiAssistant.sidebar.imageSaveFailed"));
      });
      setLocalTurns((previous) => previous.map((turn) => {
        if (turn.id !== turnId || turn.status === "cancelled") return turn;
        if (turn.images.some((image) => image.mediaType === event.mediaType && image.base64 === event.base64)) return turn;
        const index = turn.images.findIndex((image) => image.id === event.id);
        const next = { id: event.id, mediaType: event.mediaType, base64: event.base64 };
        if (index >= 0) {
          const images = turn.images.slice();
          images[index] = next;
          return { ...turn, images };
        }
        if (turn.images.length >= MAX_LOCAL_IMAGES) return turn;
        return { ...turn, images: [...turn.images, next] };
      }));
      return;
    }
    if (event.type === "error" || event.type === "done") {
      setLocalTurns((previous) => previous.map((turn) => turn.id === turnId && turn.status === "running"
        ? { ...turn, status: event.type === "error" ? "failed" : "completed" }
        : turn));
      if (event.type === "error" && event.message) {
        setError(event.message === "note_access_unavailable" ? t("aiAssistant.sidebar.noteAccessUnavailable")
          : event.message === "needs_login" ? t(localAdapterId === "workbuddyCn" || localAdapterId === "workbuddyIntl"
            ? "aiAssistant.sidebar.workbuddyLoginRequired" : "aiAssistant.sidebar.localLoginRequired")
            : event.message === "agent_refused" ? t("aiAssistant.sidebar.agentRefused") : event.message);
      }
      if (active.current?.requestId === event.requestId) {
        active.current = null;
        locked.current = false;
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    const syncSource = () => {
      setSource(readAiSidebarSource());
      setLocalAdapterId(readLocalAdapter()?.id ?? null);
    };
    syncSource();
    if (!open) return;
    window.addEventListener("focus", syncSource);
    window.addEventListener("storage", syncSource);
    return () => {
      window.removeEventListener("focus", syncSource);
      window.removeEventListener("storage", syncSource);
    };
  }, [open]);

  useEffect(() => {
    if (!companionAvailable || source === "local") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      reloadCompanion(),
      api.getCompanionDiscoverySettings().then((result) => {
        if (!cancelled && alive.current) setUseMemory(result.settings.useMemory === true);
      }),
    ]).catch((cause) => {
      if (!cancelled && alive.current) setError(explainError(cause));
    }).finally(() => {
      if (!cancelled && alive.current) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [companionAvailable, explainError, reloadCompanion, source]);

  const applyStreamEvent = useCallback((id: string, event: CompanionEvent) => {
    if (!alive.current) return;
    if (event.type === "text-delta") {
      setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, response: turn.response + event.text } : turn));
    }
    if (event.type === "process") {
      setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, process: event.text, response: "" } : turn));
    }
    if (event.type === "tools") {
      setTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, tools: event.tools, todos: event.todos, questions: event.questions } : turn));
    }
    if (event.type === "done") setTurns((previous) => previous.map((turn) => turn.id === id ? event.turn : turn));
    if (event.type === "error") {
      setError(explainError(new ApiRequestError(event.code, 500, event.code)));
      if (attachmentServerCode(event.code)) restoreAttachments(attachmentSnapshot.current);
    }
  }, [explainError, restoreAttachments]);

  const recoverTurn = useCallback(async (id: string) => {
    try {
      const { turn } = await api.getCompanionTurn(id);
      if (alive.current) setTurns((previous) => previous.map((item) => item.id === id ? turn : item));
    } catch {
      if (alive.current) {
        setTurns((previous) => previous.map((item) => item.id === id && item.status === "running" ? { ...item, status: "failed" } : item));
      }
    }
    if (alive.current) await reloadCompanion().catch(() => undefined);
    await onCompanionNotesChanged?.()?.catch(() => undefined);
  }, [onCompanionNotesChanged, reloadCompanion]);

  const skillPrompt = useCallback((id: SkillId, rest = "") => {
    const prompt = t(`aiAssistant.sidebar.skillPrompts.${id}`);
    return rest ? `${prompt}\n\n${rest}` : prompt;
  }, [t]);

  const stop = useCallback(async () => {
    const current = active.current;
    if (!current) {
      const runningTurn = turns.find((turn) => turn.threadId === threadId && turn.status === "running");
      if (!runningTurn || readAiSidebarSource() === "local") return;
      try { await api.cancelCompanionTurn(runningTurn.id); }
      catch (cause) { if (alive.current) setError(explainError(cause)); }
      await reloadCompanion().catch(() => undefined);
      return;
    }
    current.controller.abort();
    if (current.kind === "acp") {
      setLocalTurns((previous) => previous.map((turn) => turn.id === current.id && turn.status === "running"
        ? { ...turn, status: "cancelled" }
        : turn));
      if (!current.requestId) return;
      await cancelDesktopAcp(current.requestId).catch(() => undefined);
      active.current = null;
      locked.current = false;
      setBusy(false);
      return;
    }
    if (current.started) {
      try { await api.cancelCompanionTurn(current.id); }
      catch (cause) { if (alive.current) setError(explainError(cause)); }
    }
  }, [explainError, reloadCompanion, threadId, turns]);

  useEffect(() => {
    onStopReady.current = () => { void stop(); };
  }, [onStopReady, stop]);

  const launch = useCallback(async (message: string, options?: { includeCurrentNote?: boolean; readOnly?: boolean }): Promise<string> => {
    const text = message.trim();
    if (!text || locked.current) throw new Error("busy");
    const useCurrentNote = options?.includeCurrentNote ?? includeCurrentNote;
    const focusAtSend = focusRef.current;
    const mode = readAiSidebarSource();
    setSource(mode);
    if (mode === "builtin" && !focusAtSend.companionAvailable) {
      setError(t("aiAssistant.sidebar.unavailable"));
      throw new Error("unavailable");
    }
    const controller = new AbortController();
    const id = createClientUuid();
    const snapshot = attachments;
    attachmentSnapshot.current = snapshot;
    locked.current = true;
    setBusy(true);
    setError(null);
    setAttachmentError(null);
    active.current = { id, kind: mode === "local" ? "acp" : "companion", controller, started: false };
    try {
      if (mode === "local") {
        const adapter = readLocalAdapter();
        if (!adapter) {
          setError(t("aiAssistant.sidebar.localMissing"));
          throw new Error("local-missing");
        }
        if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
        const localAttachments = snapshot.map((item) => ({
          id: item.localId,
          filename: item.filename,
          mediaType: item.mediaType,
          byteLength: item.byteLength,
        }));
        const activeLocalThreadId = localThreadIdRef.current;
        const transcript = localAgentTranscript(localTurnsRef.current, activeLocalThreadId);
        const recentUserMessages = localTurnsRef.current
          .filter((turn) => turn.threadId === activeLocalThreadId && turn.status === "completed")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 6).map((turn) => turn.message);
        const noteContext = sidebarLocalContextText(focusAtSend, useCurrentNote, {
          message: text, recentUserMessages, fallbackLocale: companionLocale(i18n.resolvedLanguage),
        });
        writeStorage(AI_SIDEBAR_LOCAL_THREAD_KEY, activeLocalThreadId);
        setLocalTurns((previous) => [...previous, {
          id,
          threadId: activeLocalThreadId,
          message: text,
          response: "",
          reasoning: "",
          tools: [],
          images: [],
          attachments: localAttachments,
          status: "running",
          createdAt: new Date().toISOString(),
        }]);
        const result = await promptDesktopAcp({
          adapterId: adapter.id,
          ...(adapter.path ? { path: adapter.path } : {}),
          prompt: text,
          ...(options?.readOnly ? { noteAccess: false } : {}),
          ...((noteContext || transcript) ? { contextText: [noteContext, transcript].filter(Boolean).join("\n\n") } : {}),
          ...(snapshot.length ? {
            attachments: snapshot.map((item) => ({
              filename: item.filename,
              mediaType: item.mediaType,
              dataBase64: item.base64Data,
            })),
          } : {}),
        });
        if (controller.signal.aborted) {
          await cancelDesktopAcp(result.requestId).catch(() => undefined);
          setLocalTurns((previous) => previous.map((turn) => turn.id === id ? { ...turn, status: "cancelled" } : turn));
          throw new DOMException("aborted", "AbortError");
        }
        const rejected = new Set((result.rejectedAttachments ?? []).map((item) => item.filename));
        if (rejected.size) {
          setAttachments(snapshot.filter((item) => rejected.has(item.filename)));
          setError(t("aiAssistant.sidebar.localRejected", { names: [...rejected].join(", ") }));
        } else {
          setAttachments([]);
        }
        acpTurnIds.current.set(result.requestId, id);
        if (active.current?.id === id) active.current.requestId = result.requestId;
        active.current = active.current?.id === id ? { ...active.current, requestId: result.requestId, started: true } : active.current;
        const queued = acpBuffer.current.filter((event) => event.requestId === result.requestId);
        acpBuffer.current = acpBuffer.current.filter((event) => event.requestId !== result.requestId);
        for (const event of queued) applyAcpEventRef.current(event);
        setIncludeCurrentNote(false);
        return id;
      }

      const uploaded: UploadedCompanionAttachment[] = [];
      threadPinned.current = true;
      const activeThreadId = threadId;
      writeAiSidebarThread(activeThreadId);
      for (const item of snapshot) {
        if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
        const result = await uploadCompanionAttachment({
          filename: item.filename,
          mediaType: item.mediaType,
          base64Data: item.base64Data,
        });
        if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
        uploaded.push(result.attachment);
      }
      if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
      setAttachments([]);
      setTurns((previous) => [{
        ...emptyCompanionTurn({ id, threadId: activeThreadId, message: text }),
        attachments: uploaded.map((item) => ({
          id: item.id,
          filename: item.filename,
          mediaType: item.mediaType,
          byteLength: item.byteLength,
        })),
      }, ...previous]);
      if (active.current?.id === id) active.current.started = true;
      const focus = sidebarCompanionFocus(focusAtSend, useCurrentNote);
      const payload: CompanionTurnInput = {
        id,
        threadId: activeThreadId,
        message: text,
        useMemory,
        allowNotes: true,
        allowWrites: !options?.readOnly,
        locale: companionLocale(i18n.resolvedLanguage),
        ...(uploaded.length ? { attachmentIds: uploaded.map((item) => item.id) } : {}),
        ...(focus ? { focus } : {}),
      };
      setIncludeCurrentNote(false);
      void (async () => {
        let completed = false;
        try {
          await api.streamCompanion(payload, {
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === "done") completed = true;
              applyStreamEvent(id, event);
            },
          });
        } catch (cause) {
          if (attachmentServerCode(cause instanceof ApiRequestError ? cause.code : undefined)) {
            restoreAttachments(snapshot);
          }
          if (alive.current && !controller.signal.aborted && !completed) setError(explainError(cause));
        } finally {
          if (active.current?.id === id) active.current = null;
          locked.current = false;
          if (alive.current) {
            setBusy(false);
            await recoverTurn(id);
          }
        }
      })();
      return id;
    } catch (cause) {
      if (active.current?.id === id) active.current = null;
      locked.current = false;
      setBusy(false);
      if (!isAbortError(cause)) {
        setLocalTurns((previous) => previous.map((turn) => turn.id === id && turn.status === "running" ? { ...turn, status: "failed" } : turn));
      }
      if (isAbortError(cause)) throw cause;
      const code = cause instanceof ApiRequestError ? attachmentServerCode(cause.code) : null;
      if (code) {
        setError(explainError(cause));
        throw cause;
      }
      if (cause instanceof Error && cause.message === "desktop_acp_unavailable") {
        setError(t("aiAssistant.sidebar.localMissing"));
        throw cause;
      }
      if (cause instanceof Error && (cause.message === "unavailable" || cause.message === "local-missing")) throw cause;
      setError(explainError(cause));
      throw cause;
    }
  }, [applyStreamEvent, attachments, explainError, i18n.resolvedLanguage, includeCurrentNote, recoverTurn, restoreAttachments, t, threadId, useMemory]);

  const rememberSelectionTurn = useCallback((id: string, kind: "explain" | "translate") => {
    setSelectionTurnKinds((current) => {
      const next = { ...current, [id]: kind };
      const ids = Object.keys(next);
      if (ids.length > 80) {
        for (const oldId of ids.slice(0, ids.length - 80)) delete next[oldId];
      }
      try {
        window.sessionStorage.setItem(SELECTION_TURN_STORAGE, JSON.stringify(next));
      } catch {
        // Session storage can be unavailable in private mode.
      }
      return next;
    });
  }, []);

  const selectionMessage = useCallback((kind: "explain" | "translate", language?: SelectionAiLanguage) => {
    if (!selectionPin) return "";
    const quote = selectionPin.displayText || selectionPin.sentText;
    const notice = selectionPin.truncated
      ? t("aiAssistant.sidebar.selection.truncated", { count: Array.from(quote).length })
      : "";
    const instruction = kind === "explain"
      ? t("aiAssistant.sidebar.selection.explainPrompt")
      : language
        ? t("aiAssistant.sidebar.selection.translateLanguagePrompt", {
            language: t(`aiAssistant.sidebar.selection.languageNames.${language}`),
          })
        : t("aiAssistant.sidebar.selection.translatePrompt");
    return selectionAiUserMessage({ instruction, notice, quote });
  }, [selectionPin, t]);

  const retranslateSelection = useCallback((language: SelectionAiLanguage) => {
    const message = selectionMessage("translate", language);
    if (!message || locked.current) return;
    void launch(message, { readOnly: true }).then((id) => {
      rememberSelectionTurn(id, "translate");
    }).catch(() => undefined);
  }, [launch, rememberSelectionTurn, selectionMessage]);

  useEffect(() => {
    const request = selectionRequest;
    if (!request || handledSelectionRequestId.current === request.id) return;
    if (request.kind === "ask") {
      handledSelectionRequestId.current = request.id;
      setComposerFocusToken((current) => current + 1);
      return;
    }
    if (!selectionPin || locked.current || loading) return;
    const message = selectionMessage(request.kind);
    if (!message) return;
    handledSelectionRequestId.current = request.id;
    void launch(message, { readOnly: true }).then((id) => {
      rememberSelectionTurn(id, request.kind === "explain" ? "explain" : "translate");
    }).catch(() => undefined);
  }, [busy, launch, loading, rememberSelectionTurn, selectionMessage, selectionPin, selectionRequest]);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    let existing: PreparedAiAttachment[] = attachments;
    const added: PendingAttachment[] = [];
    let nextError: string | null = null;
    for (const file of files) {
      try {
        const [prepared] = await prepareAiAttachments([file], existing);
        if (!prepared) continue;
        existing = [...existing, prepared];
        added.push({
          ...prepared,
          localId: createClientUuid(),
          previewUrl: prepared.mediaType.startsWith("image/") ? `data:${prepared.mediaType};base64,${prepared.base64Data}` : null,
        });
      } catch (cause) {
        const code = cause instanceof AiAttachmentError ? cause.code : "readFailed";
        nextError = t(`aiAssistant.attachmentErrors.${code}`);
      }
    }
    if (added.length) setAttachments((current) => [...current, ...added]);
    setAttachmentError(nextError);
  }, [attachments, t]);

  useEffect(() => {
    addFilesRef.current = (files) => { void addFiles(files); };
  }, [addFiles, addFilesRef]);

  const resume = (turn: CompanionTurn, answers?: CompanionAnswer[]) => {
    if (locked.current) return;
    const controller = new AbortController();
    locked.current = true;
    setBusy(true);
    setError(null);
    active.current = { id: turn.id, kind: "companion", controller, started: true };
    setTurns((previous) => previous.map((item) => item.id === turn.id ? { ...item, status: "running" } : item));
    void (async () => {
      let completed = false;
      try {
        await api.resumeCompanionTurn(turn.id, answers ? { answers } : {}, {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "done") completed = true;
            applyStreamEvent(turn.id, event);
          },
        });
      } catch (cause) {
        if (alive.current && !controller.signal.aborted && !completed) setError(explainError(cause));
      } finally {
        if (active.current?.id === turn.id) active.current = null;
        locked.current = false;
        if (alive.current) setBusy(false);
        if (alive.current) await recoverTurn(turn.id);
      }
    })();
  };

  const applyAction = async (action: CompanionAction) => {
    if (locked.current) return;
    locked.current = true;
    setActing(true);
    setError(null);
    try {
      await beforeCompanionApply?.();
      const result = await api.applyCompanionAction(action.id);
      if (alive.current) {
        setConflicts((current) => {
          const next = { ...current };
          delete next[action.id];
          return next;
        });
        setActions((previous) => previous.map((item) => item.id === action.id ? result.action : item));
      }
      try {
        await onCompanionNotesChanged?.();
      } catch {
        if (alive.current) setError(t("companion.actions.syncFailed"));
      }
      await reloadCompanion().catch(() => undefined);
    } catch (cause) {
      if (cause instanceof ApiRequestError && (cause.status === 409 || cause.code === "companion_action_conflict")) {
        if (alive.current) setConflicts((current) => ({ ...current, [action.id]: t("aiAssistant.sidebar.proposalConflict") }));
        return;
      }
      if (alive.current) setError(explainError(cause));
    } finally {
      locked.current = false;
      if (alive.current) setActing(false);
    }
  };

  const dismissAction = async (action: CompanionAction) => {
    if (locked.current) return;
    locked.current = true;
    setActing(true);
    try {
      await api.dismissCompanionAction(action.id);
      await reloadCompanion();
    } catch (cause) {
      if (alive.current) setError(explainError(cause));
    } finally {
      locked.current = false;
      if (alive.current) setActing(false);
    }
  };

  const openLinkedNote = (event: MouseEvent<HTMLElement>, sources: Array<{ id: string; notebookId?: string }>) => {
    if (!onOpenCompanionNote) return;
    const linkedId = memoIdFromSidebarLinkEvent(event);
    if (!linkedId) return;
    onOpenCompanionNote(linkedId, sources.find((item) => item.id === linkedId)?.notebookId ?? "");
  };

  const companionThreads = useMemo(() => chatThreadsFromTurns(turns), [turns]);
  const localThreadList = useMemo(() => chatThreadsFromTurns(localTurns), [localTurns]);
  const menuThreads = source === "builtin" ? companionThreads : localThreadList;
  const menuThreadId = source === "builtin" ? threadId : localThreadId;
  const threadTitle = menuThreads.find((thread) => thread.id === menuThreadId)?.title || t("aiAssistant.sidebar.newThread");
  const rememberThread = (id: string) => {
    threadPinned.current = true;
    setThreadId(id);
    setError(null);
    writeAiSidebarThread(id);
  };
  const selectLocalThread = (id: string) => {
    setLocalThreadId(id);
    setError(null);
    writeStorage(AI_SIDEBAR_LOCAL_THREAD_KEY, id);
  };
  const threadTurns = turns.filter((turn) => turn.threadId === threadId).slice().reverse();
  const localThreadTurns = localTurns.filter((turn) => turn.threadId === localThreadId);
  const visibleCompanion = source === "builtin";
  const visibleTurns = visibleCompanion ? threadTurns : localThreadTurns;
  const running = busy || visibleTurns.some((turn) => turn.status === "running");

  const renderSelectionReply = (turnId: string, response: string, status: string) => {
    const kind = selectionTurnKinds[turnId];
    if (!kind || status !== "completed" || !response.trim()) return null;
    return (
      <SelectionReplyActions
        kind={kind}
        response={response}
        pinned={Boolean(selectionPin)}
        busy={running || acting}
        onReplace={(replacement) => onReplaceSelection?.(replacement) ?? false}
        onRetranslate={retranslateSelection}
      />
    );
  };

  const renderActions = (turnId: string) => actions
    .filter((action) => action.turnId === turnId && action.status === "pending")
    .map((action) => {
      const draft = noteEditDraft(action);
      return (
        <div key={action.id} className="space-y-2 rounded-md border border-slate-200 p-2">
          <p className="text-xs leading-5 text-slate-600">{action.plan.reason}</p>
          {draft ? <NoteEditDiff before={draft.before} after={draft.after} /> : null}
          {conflicts[action.id] ? <p role="alert" className="text-xs text-rose-700">{conflicts[action.id]}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="solid" className="border-slate-900 bg-slate-900 hover:border-slate-800 hover:bg-slate-800" disabled={running || acting} onClick={() => void applyAction(action)}>
              {t(draft ? "aiAssistant.sidebar.proposalConfirm" : "aiAssistant.sidebar.proposalConfirmOther")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={running || acting} onClick={() => void dismissAction(action)}>
              {t(draft ? "aiAssistant.sidebar.proposalReject" : "aiAssistant.sidebar.proposalDismiss")}
            </Button>
          </div>
        </div>
      );
    });

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-2">
        <AiSidebarThreadMenu
          threads={menuThreads}
          threadId={menuThreadId}
          title={threadTitle}
          onSelect={source === "builtin" ? rememberThread : selectLocalThread}
          onCreate={() => {
            if (source === "local") {
              if (localTurns.some((turn) => turn.threadId === localThreadId)) selectLocalThread(createClientUuid());
              return;
            }
            if (companionThreads.some((thread) => thread.id === threadId)) rememberThread(createClientUuid());
          }}
        />
        {source === "local" ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="ml-auto min-w-0 max-w-[46%] shrink truncate rounded-sm text-right text-xs text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  data-ai-local-agent=""
                  tabIndex={0}
                >
                  {localAdapterId ? t(`aiAssistant.agentSource.${localAdapterId}`) : t("aiAssistant.sidebar.localStatus")}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>{localAdapterId ? t(`aiAssistant.agentSource.${localAdapterId}`) : t("aiAssistant.sidebar.localStatus")}</p>
                <p className="mt-1">{t("aiAssistant.agentSource.localHint")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : <BuiltinAgentStatus />}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("aiAssistant.sidebar.close")}
          aria-label={t("aiAssistant.sidebar.close")}
          onClick={() => onOpenChange(false)}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      {error ? <p role="alert" className="shrink-0 px-3 pt-2 text-sm text-rose-700">{error}</p> : null}
      <Conversation key={menuThreadId} className="min-h-0 flex-1">
        <ConversationContent className={sidebarThreadClassName}>
          {loading && visibleCompanion ? <p role="status" className="text-sm text-slate-500">{t("common.loading")}</p> : null}
          {!loading && !visibleTurns.length ? (
            <ConversationEmptyState
              icon={<Sparkles className="h-6 w-6" />}
              title={t("aiAssistant.sidebar.emptyTitle")}
            />
          ) : null}
          {visibleCompanion ? threadTurns.map((turn) => (
            <div key={turn.id} className="space-y-2" onClick={(event) => openLinkedNote(event, turn.sources)}>
              <Message from="user">
                <MessageContent className={sidebarUserMessageClassName}>{turn.message}</MessageContent>
                <AttachmentChips items={turn.attachments ?? []} />
              </Message>
              <Message from="assistant">
                {turn.process?.trim() ? (
                  <Reasoning isStreaming={turn.status === "running"} className="mb-2">
                    <ReasoningTrigger
                      className="-ml-1 min-h-7 w-fit gap-1.5 rounded-sm px-1 py-1 text-xs leading-4 text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 [&_svg]:size-3"
                      getThinkingMessage={() => t("companion.process")}
                    />
                    <ReasoningContent className="mt-2 text-xs leading-5">{turn.process}</ReasoningContent>
                  </Reasoning>
                ) : turn.status === "running" ? (
                  <p role="status" className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {t("aiAssistant.sidebar.working")}
                  </p>
                ) : null}
                {turn.tools?.length ? (
                  <ul className="space-y-1 text-xs text-slate-500">
                    {turn.tools.map((tool) => (
                      <li key={tool.id}>{t("aiAssistant.sidebar.toolProgress", { name: tool.name, status: tool.status })}</li>
                    ))}
                  </ul>
                ) : null}
                {turn.response ? (
                  <AiSidebarMessage isAnimating={turn.status === "running"}>
                    {linkedCompanionText(turn.response, turn)}
                  </AiSidebarMessage>
                ) : null}
                {turn.status === "interrupted" && turn.questions?.length && !running ? (
                  <CompanionQuestionForm questions={turn.questions} busy={busy || acting} onSubmit={(answers) => resume(turn, answers)} />
                ) : null}
                {turn.status === "interrupted" && !turn.questions?.length && !running ? (
                  <Button type="button" size="sm" variant="outline" disabled={busy || acting} onClick={() => resume(turn)}>
                    {t("companion.continue")}
                  </Button>
                ) : null}
                {turn.status === "failed" || turn.status === "cancelled" ? (
                  <p className="text-xs text-slate-500">{t(`companion.status.${turn.status}`)}</p>
                ) : null}
                {renderSelectionReply(turn.id, turn.response, turn.status)}
                {renderActions(turn.id)}
              </Message>
            </div>
          )) : localThreadTurns.map((turn) => (
            <div key={turn.id} className="space-y-2" onClick={(event) => openLinkedNote(event, [])}>
              <Message from="user">
                <MessageContent className={sidebarUserMessageClassName}>{turn.message}</MessageContent>
                <AttachmentChips items={turn.attachments} />
              </Message>
              <Message from="assistant">
                {turn.reasoning.trim() || turn.tools.length ? (
                  <AiSidebarLocalProcess reasoning={turn.reasoning} tools={turn.tools} running={turn.status === "running"} />
                ) : turn.status === "running" ? (
                  <p role="status" className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {t("aiAssistant.sidebar.working")}
                  </p>
                ) : null}
                {turn.images.length ? (
                  <div className="flex flex-col gap-2">
                    {turn.images.map((image, index) => (
                      <div key={image.id} className="space-y-1">
                        <Image
                          alt={t("aiAssistant.sidebar.generatedImage")}
                          base64={image.base64}
                          className="max-h-96"
                          mediaType={image.mediaType}
                          uint8Array={EMPTY_IMAGE_BYTES}
                        />
                        <a
                          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                          download={`edgeever-image-${turn.id.slice(0, 8)}-${index + 1}.${image.mediaType === "image/jpeg" ? "jpg" : image.mediaType === "image/webp" ? "webp" : image.mediaType === "image/gif" ? "gif" : "png"}`}
                          href={`data:${image.mediaType};base64,${image.base64}`}
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          {t("aiAssistant.sidebar.downloadImage")}
                        </a>
                      </div>
                    ))}
                  </div>
                ) : null}
                {turn.response ? <AiSidebarMessage isAnimating={turn.status === "running"}>{turn.response}</AiSidebarMessage> : null}
                {renderSelectionReply(turn.id, turn.response, turn.status)}
                {turn.status === "failed" || turn.status === "cancelled" ? (
                  <p className="text-xs text-slate-500">{t(`companion.status.${turn.status}`)}</p>
                ) : null}
              </Message>
            </div>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="shrink-0 space-y-2 p-3">
        {selectionPin ? (
          <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2" data-selection-pin="">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{selectionPin.displayText || selectionPin.sentText}</p>
              {selectionPin.truncated ? (
                <p className="mt-1 text-xs text-slate-500">
                  {t("aiAssistant.sidebar.selection.truncated", { count: Array.from(selectionPin.displayText || selectionPin.sentText).length })}
                </p>
              ) : null}
            </div>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("aiAssistant.sidebar.selection.dismiss")}
                    onClick={() => onDismissSelectionPin?.()}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("aiAssistant.sidebar.selection.dismiss")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : null}
        {!companionAvailable && source !== "local" ? (
          <p className="text-xs leading-5 text-slate-500">{t("aiAssistant.sidebar.unavailable")}</p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {SKILLS.map((skill) => (
            <Button
              key={skill.id}
              type="button"
              size="sm"
              variant="outline"
              disabled={running || acting}
              onClick={() => void launch(skillPrompt(skill.id), { includeCurrentNote: true }).catch(() => undefined)}
            >
              {t(`aiAssistant.sidebar.skills.${skill.id}`)}
            </Button>
          ))}
        </div>
        <PromptInputProvider>
          <SidebarComposer
            attachments={attachments}
            attachmentError={attachmentError}
            busy={running}
            locked={acting}
            includeCurrentNote={includeCurrentNote}
            currentNoteAvailable={Boolean(noteTitle?.trim() || contentMarkdown?.trim())}
            onIncludeCurrentNoteChange={setIncludeCurrentNote}
            placeholder={t("aiAssistant.sidebar.placeholder")}
            onAddFiles={(files) => { void addFiles(files); }}
            onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.localId !== id))}
            onLaunch={launch}
            onStop={() => { void stop(); }}
            skillPrompt={skillPrompt}
            focusToken={composerFocusToken}
          />
        </PromptInputProvider>
      </div>
    </div>
  );
}

export function AiSidebar(props: AiSidebarProps) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;
  const [width, setWidth] = useState(readAiSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  const addFilesRef = useRef<(files: File[]) => void>(() => undefined);
  const onStopReady = useRef<() => void>(() => undefined);

  useEffect(() => {
    const media = window.matchMedia(NARROW_QUERY);
    const sync = () => {
      setNarrow(media.matches);
      setViewportWidth(window.innerWidth);
    };
    sync();
    media.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (narrow) return;
    event.preventDefault();
    setResizing(true);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const move = (pointer: PointerEvent) => {
      setWidth(clampSidebarWidth(startWidth + startX - pointer.clientX));
    };
    const up = (pointer: PointerEvent) => {
      const next = clampSidebarWidth(startWidth + startX - pointer.clientX);
      setWidth(next);
      writeStorage(AI_SIDEBAR_WIDTH_KEY, String(next));
      setResizing(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  const panelWidth = narrow ? Math.min(viewportWidth, 384) : width;

  return (
    <>
      <AnimatePresence>
        {open && narrow ? (
          <m.button
            key="ai-sidebar-scrim"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={sidebarRevealTransition}
            className="fixed inset-0 z-40 bg-slate-950/25"
            aria-label={t("aiAssistant.sidebar.close")}
            onClick={() => onOpenChange(false)}
          />
        ) : null}
      </AnimatePresence>
      <m.aside
        initial={false}
        animate={narrow ? { x: open ? 0 : "100%", width: panelWidth } : { x: 0, width: open ? width : 0 }}
        transition={resizing ? { duration: 0 } : sidebarRevealTransition}
        aria-hidden={!open}
        aria-label={t("aiAssistant.sidebar.title")}
        inert={open ? undefined : true}
        className={cn(
          "h-full min-h-0 min-w-0 shrink-0 overflow-hidden bg-card",
          narrow ? "fixed inset-y-0 right-0 z-50 shadow-xl" : "relative",
        )}
        onDragOverCapture={(event) => {
          if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
        }}
        onDropCapture={(event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.length) return;
          event.preventDefault();
          event.stopPropagation();
          addFilesRef.current(files);
        }}
      >
        <div className="absolute inset-y-0 right-0 flex min-h-0 flex-col border-l border-slate-200 bg-card" style={{ width: panelWidth }}>
          {open && !narrow ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={SIDEBAR_MIN_WIDTH}
                    aria-valuemax={SIDEBAR_MAX_WIDTH}
                    aria-valuenow={width}
                    aria-label={t("aiAssistant.sidebar.resize")}
                    tabIndex={0}
                    className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize"
                    onPointerDown={resize}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const next = clampSidebarWidth(width + (event.key === "ArrowLeft" ? 16 : -16));
                      setWidth(next);
                      writeStorage(AI_SIDEBAR_WIDTH_KEY, String(next));
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent side="left">{t("aiAssistant.sidebar.resize")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {props.infographic ? (
            <InfographicSidebarSession
              session={props.infographic}
              noteTitle={props.noteTitle}
              onOpenChange={onOpenChange}
              onOpenNote={props.onOpenCompanionNote}
            />
          ) : (
            <AiSidebarSession {...props} addFilesRef={addFilesRef} onStopReady={onStopReady} />
          )}
        </div>
      </m.aside>
    </>
  );
}
