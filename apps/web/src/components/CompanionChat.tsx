import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Folder, Loader2, MessageCircle, Tag, X } from "lucide-react";
import type {
  CompanionAction, CompanionAnswer, CompanionDiscoverySettings, CompanionEvent, CompanionMention, CompanionTurn, CompanionTurnInput,
} from "@edgeever/shared";
import { companionFailureDiagnostics, parseCompanionMentionQuery, getMemoDisplayTitle } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api";
import { companionLocale } from "@/lib/companion-locale";
import { CompanionActionCard } from "./CompanionActionCard";
import { CompanionCreatedNoteLinks } from "./CompanionCreatedNoteLinks";
import { CompanionNoteText } from "./CompanionNoteText";
import { CompanionQuestionForm } from "./CompanionQuestionForm";
import { CompanionRunTimeline } from "./CompanionRunTimeline";

export type CompanionChatFocus = {
  memoId?: string;
  notebookId?: string;
  notebookTitle?: string;
  title?: string;
  selectionMarkdown?: string | null;
  contentMarkdown?: string | null;
  contentTruncated?: boolean;
  diagramKind?: "mind-map" | "flowchart" | "architecture";
};

type CompanionChatProps = {
  available: boolean;
  focus?: CompanionChatFocus;
  placeholder?: string;
  beforeApply: () => Promise<void>;
  onNotesChanged: () => Promise<void>;
  onOpenNote: (id: string, notebookId: string) => void;
};

const emptyTurn = (partial: Pick<CompanionTurn, "id" | "threadId" | "message">): CompanionTurn => ({
  ...partial, response: "", process: "", status: "running", sources: [], tools: [], todos: [], questions: [], mentions: [],
  model: "", inputTokens: null, outputTokens: null, createdAt: new Date().toISOString(),
});

export function CompanionChat({
  available, focus, placeholder, beforeApply, onNotesChanged, onOpenNote,
}: CompanionChatProps) {
  const { t, i18n } = useTranslation();
  const [turns, setTurns] = useState<CompanionTurn[]>([]);
  const [actions, setActions] = useState<CompanionAction[]>([]);
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [mentions, setMentions] = useState<CompanionMention[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useMemory, setUseMemory] = useState(false);
  const [settings, setSettings] = useState<CompanionDiscoverySettings | null>(null);
  const [mentionHits, setMentionHits] = useState<CompanionMention[]>([]);
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinToBottom = useRef(true);
  const mentionQuery = parseCompanionMentionQuery(message, cursor);

  const explainError = (cause: unknown) => {
    const code = cause instanceof ApiRequestError ? cause.code : "";
    if (code === "ai_client_required" || code === "ai_direct_unavailable") return t("companion.clientUpdateRequired");
    if (code === "ai_not_configured") return t("companion.configureModel");
    if (code === "ai_credentials_rejected") return t("companion.credentialsRejected");
    if (code === "ai_provider_payment_required") return t("companion.providerPaymentRequired");
    if (code === "ai_provider_rate_limited") return t("companion.providerRateLimited");
    if (code === "ai_provider_request_rejected") return t("companion.providerRequestRejected");
    if (code === "companion_response_too_long") return t("companion.responseTooLong");
    if (code === "companion_memory_conflict") return t("companion.conflict");
    if (code === "companion_history_full") return t("companion.historyFull");
    if (code === "companion_action_conflict") return t("companion.actions.conflict");
    if (code === "companion_action_unsynced") return t("companion.actions.unsynced");
    if (code === "companion_action_uncertain") return t("companion.actions.status.uncertain");
    if (code === "companion_busy") return t("companion.recovered");
    if (cause instanceof ApiRequestError && cause.status === 403) return t("companion.unavailable");
    if (companionFailureDiagnostics(cause)?.reason === "network") return t("companion.failureDetails.network");
    return t("companion.failed");
  };
  const reload = async () => {
    const [turnResult, actionResult] = await Promise.all([
      api.listCompanionTurns(),
      api.listCompanionActions(),
    ]);
    if (!alive.current) return;
    setTurns(turnResult.turns);
    setActions(actionResult.actions);
  };

  useEffect(() => {
    alive.current = true;
    if (!available) {
      setLoading(false);
      return () => { alive.current = false; active.current?.controller.abort(); };
    }
    void Promise.all([reload(), api.getCompanionDiscoverySettings().then(result => {
      if (!alive.current) return;
      setSettings(result.settings);
      setUseMemory(result.settings.useMemory === true);
    })]).catch(cause => { if (alive.current) setError(explainError(cause)); })
      .finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; active.current?.controller.abort(); };
    // This workspace owns ephemeral account-scoped state, discarded on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  useEffect(() => {
    if (!mentionQuery || !available) { setMentionHits([]); return; }
    const query = mentionQuery.query;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([
        api.listMemos({ q: query, trash: false, sort: "updated-desc", limit: 8, includeTotal: false }),
        api.listNotebooks(),
        api.listTags(),
      ]).then(([memos, notebooks, tags]) => {
        if (cancelled || !alive.current) return;
        const lower = query.toLowerCase();
        setMentionHits([
          ...memos.memos.slice(0, 5).map(memo => ({ type: "memo" as const, id: memo.id, title: getMemoDisplayTitle(memo.title, t("common.untitledMemo")) })),
          ...notebooks.notebooks.filter(notebook => !query || notebook.name.toLowerCase().includes(lower)).slice(0, 4)
            .map(notebook => ({ type: "notebook" as const, id: notebook.id, title: notebook.name })),
          ...tags.tags.filter(tag => !query || tag.name.toLowerCase().includes(lower)).slice(0, 4)
            .map(tag => ({ type: "tag" as const, id: tag.name, title: tag.name })),
        ].filter(item => !mentions.some(mention => mention.type === item.type && mention.id === item.id)).slice(0, 8));
      }).catch(() => { if (!cancelled && alive.current) setMentionHits([]); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [available, mentionQuery?.query, mentionQuery?.start, mentions, t]);

  const perform = async (work: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(null);
    try { await work(); await reload(); }
    catch (cause) { if (alive.current) setError(explainError(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };

  const applyStreamEvent = (id: string, event: CompanionEvent) => {
    if (!alive.current) return;
    if (event.type === "text-delta") setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, response: turn.response + event.text } : turn));
    if (event.type === "process") setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, process: event.text, response: "" } : turn));
    if (event.type === "tools") setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, tools: event.tools, todos: event.todos, questions: event.questions } : turn));
    if (event.type === "done") setTurns(previous => previous.map(turn => turn.id === id ? event.turn : turn));
    if (event.type === "error") setError(explainError(new ApiRequestError(event.code, 500, event.code)));
  };

  const recoverTurn = async (id: string, fallback: string) => {
    try {
      const { turn } = await api.getCompanionTurn(id);
      setTurns(previous => previous.map(item => item.id === id ? turn : item));
    } catch {
      setTurns(previous => previous.filter(item => item.id !== id));
      setMessage(fallback);
    }
    await onNotesChanged().catch(() => {});
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || locked.current) return;
    pinToBottom.current = true;
    const pinned = mentions;
    void perform(async () => {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      active.current = { id, controller };
      setMessage("");
      setMentions([]);
      setTurns(previous => [{ ...emptyTurn({ id, threadId, message: text }), mentions: pinned }, ...previous]);
      let completed = false;
      const payload: CompanionTurnInput = {
        id, threadId, message: text, useMemory,
        allowNotes: true,
        allowWrites: true,
        locale: companionLocale(i18n.resolvedLanguage),
        ...(pinned.length ? { mentions: pinned } : {}),
        ...(focus?.memoId || focus?.selectionMarkdown?.trim() || focus?.contentMarkdown?.trim() || focus?.diagramKind
          ? { focus: {
            ...(focus.memoId ? { memoId: focus.memoId } : {}),
            ...(focus.notebookId ? { notebookId: focus.notebookId } : {}),
            ...(focus.notebookTitle ? { notebookTitle: focus.notebookTitle } : {}),
            ...(focus.title ? { title: focus.title } : {}),
            ...(focus.selectionMarkdown?.trim() ? { selectionMarkdown: focus.selectionMarkdown.trim().slice(0, 2000) } : {}),
            ...(focus.diagramKind ? { diagramKind: focus.diagramKind } : {}),
            ...(!focus.diagramKind && focus.contentMarkdown?.trim()
              ? {
                contentMarkdown: focus.contentMarkdown.trim().slice(0, 4000),
                ...(focus.contentTruncated ? { contentTruncated: true } : {}),
              }
              : {}),
          } }
          : {}),
      };
      try {
        await api.streamCompanion(payload, {
          signal: controller.signal,
          onEvent: event => {
            if (event.type === "done") completed = true;
            applyStreamEvent(id, event);
          },
        });
      } catch (cause) {
        if (alive.current && !controller.signal.aborted && !completed) setError(explainError(cause));
      } finally {
        active.current = null;
        if (alive.current) await recoverTurn(id, text);
      }
    });
  };

  const resume = (turn: CompanionTurn, answers?: CompanionAnswer[]) => void perform(async () => {
    const controller = new AbortController();
    active.current = { id: turn.id, controller };
    setTurns(previous => previous.map(item => item.id === turn.id ? { ...item, status: "running" } : item));
    let completed = false;
    try {
      await api.resumeCompanionTurn(turn.id, answers ? { answers } : {}, {
        signal: controller.signal,
        onEvent: event => {
          if (event.type === "done") completed = true;
          applyStreamEvent(turn.id, event);
        },
      });
    } catch (cause) {
      if (alive.current && !controller.signal.aborted && !completed) setError(explainError(cause));
    } finally {
      active.current = null;
      if (alive.current) await recoverTurn(turn.id, "");
    }
  });

  const stop = async (id: string) => {
    try { await api.cancelCompanionTurn(id); active.current?.controller.abort(); await reload(); }
    catch (cause) { if (alive.current) setError(explainError(cause)); }
  };
  const applyAction = (action: CompanionAction) => void perform(async () => {
    await beforeApply();
    try {
      const result = await api.applyCompanionAction(action.id);
      if (alive.current) setActions(previous => previous.map(item => item.id === action.id ? result.action : item));
      try { await onNotesChanged(); }
      catch { if (alive.current) setError(t(result.action.status === "applied" ? "companion.actions.syncFailed" : "companion.actions.status.uncertain")); }
    } finally {
      await reload().catch(() => {});
    }
  });
  const toggleMemory = async (next: boolean) => {
    if (!settings) { setUseMemory(next); return; }
    try {
      const result = await api.saveCompanionDiscoverySettings({
        enabled: settings.enabled, learningEnabled: settings.learningEnabled, useMemory: next, version: settings.version,
      });
      setSettings(result.settings);
      setUseMemory(result.settings.useMemory === true);
    } catch (cause) { setError(explainError(cause)); }
  };
  const pickMention = (mention: CompanionMention) => {
    if (!mentionQuery) return;
    setMessage(value => `${value.slice(0, mentionQuery.start)}${value.slice(mentionQuery.end)}`.replace(/\s+$/, " "));
    setMentions(previous => previous.some(item => item.type === mention.type && item.id === mention.id) ? previous : [...previous, mention].slice(0, 8));
    setMentionHits([]);
  };

  const threads = [...new Map(turns.map(turn => [turn.threadId, turn])).values()];
  const running = turns.find(turn => turn.status === "running");
  const threadTurns = turns.filter(turn => turn.threadId === threadId).reverse();
  const previousThread = threads.find(thread => thread.threadId !== threadId);
  const mentionLabel = (mention: CompanionMention) => mention.title || mention.id;
  const mentionIcon = (type: CompanionMention["type"]) => type === "notebook" ? Folder : type === "tag" ? Tag : FileText;

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !pinToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [turns, threadId, actions]);

  if (!available) {
    return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center">
      <MessageCircle aria-hidden="true" className="h-9 w-9 text-slate-500" />
      <p className="max-w-md text-sm leading-relaxed text-slate-600">{t("companion.unavailableHelp")}</p>
    </div>;
  }

  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {loading ? <p role="status">{t("common.loading")}</p> : null}
    <div
      ref={scroller}
      className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
      onScroll={event => {
        const node = event.currentTarget;
        pinToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      {!loading && !threadTurns.length && previousThread ? <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-slate-500">{previousThread.message}</p>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { pinToBottom.current = true; setThreadId(previousThread.threadId); }}>
          {t("aiAssistant.modes.resumeLast")}
        </Button>
      </div> : null}
      {threadTurns.map(turn => <article key={turn.id} className="space-y-2 rounded-lg border p-3 text-sm">
        <p className="whitespace-pre-wrap break-words font-medium">{turn.message}</p>
        {turn.mentions?.length ? (
          <ul className="flex flex-wrap gap-1">
            {turn.mentions.map(mention => {
              const Icon = mentionIcon(mention.type);
              return <li key={`${mention.type}:${mention.id}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                <Icon className="h-3 w-3" />{mentionLabel(mention)}
              </li>;
            })}
          </ul>
        ) : null}
        <CompanionRunTimeline
          process={turn.process ?? ""}
          tools={turn.tools ?? []}
          todos={turn.todos ?? []}
          expanded={turn.status === "running"}
          busy={busy || Boolean(running)}
          onOpenNote={onOpenNote}
          onNotesChanged={onNotesChanged}
        />
        {turn.response ? <CompanionNoteText text={turn.response} sources={turn.sources} onOpenNote={onOpenNote} /> : null}
        <CompanionCreatedNoteLinks response={turn.response} tools={turn.tools ?? []} onOpenNote={onOpenNote} />
        {turn.status === "interrupted" && turn.questions?.length && !running ? (
          <CompanionQuestionForm questions={turn.questions} busy={busy} onSubmit={answers => resume(turn, answers)} />
        ) : null}
        {turn.status === "interrupted" && !turn.questions?.length && !running ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => resume(turn)}>{t("companion.continue")}</Button>
        ) : null}
        {turn.status === "running" ? (
          <p role="status" className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden="true" />
            <span className="sr-only">{t("companion.status.running")}</span>
          </p>
        ) : turn.status === "failed" || turn.status === "cancelled" ? (
          <p className="text-xs text-slate-500">{t(`companion.status.${turn.status}`)}</p>
        ) : null}
        {actions.filter(action => action.turnId === turn.id).map(action => <CompanionActionCard key={action.id} action={action}
          busy={busy || Boolean(running)} onApply={applyAction} onDismiss={item => void perform(() => api.dismissCompanionAction(item.id))} onOpenNote={onOpenNote} />)}
      </article>)}
    </div>
    <form onSubmit={send} className="border-t pt-3">
      <p id="companion-ask-hint" className="sr-only">{t("aiAssistant.modes.askHint")}</p>
      {mentions.length ? (
        <ul className="mb-2 flex flex-wrap gap-1">
          {mentions.map(mention => {
            const Icon = mentionIcon(mention.type);
            return <li key={`${mention.type}:${mention.id}`}>
              <button type="button" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-800"
                aria-label={t("companion.mentions.remove", { title: mentionLabel(mention) })}
                onClick={() => setMentions(previous => previous.filter(item => item !== mention))}>
                <Icon className="h-3 w-3" />{mentionLabel(mention)}<X className="h-3 w-3" />
              </button>
            </li>;
          })}
        </ul>
      ) : null}
      {mentionHits.length ? (
        <ul className="mb-2 max-h-36 overflow-y-auto rounded-md border bg-card py-1 text-xs">
          {mentionHits.map(mention => {
            const Icon = mentionIcon(mention.type);
            return <li key={`${mention.type}:${mention.id}`}>
              <button type="button" className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-50"
                onClick={() => pickMention(mention)}>
                <Icon className="h-3.5 w-3.5 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{mentionLabel(mention)}</span>
                <span className="text-xs text-slate-400">{t(`companion.mentions.${mention.type === "memo" ? "notes" : mention.type === "notebook" ? "notebooks" : "tags"}`)}</span>
              </button>
            </li>;
          })}
        </ul>
      ) : mentionQuery ? <p className="mb-2 text-xs text-slate-400">{t("companion.mentions.empty")}</p> : null}
      <label className="sr-only" htmlFor="companion-message">{t("companion.message")}</label>
      <div className="flex items-end gap-2">
        <textarea
          id="companion-message"
          rows={2}
          aria-describedby="companion-ask-hint"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm leading-5 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          maxLength={4000}
          value={message}
          disabled={busy}
          placeholder={placeholder || t("companion.mentions.hint")}
          onChange={event => { setMessage(event.target.value); setCursor(event.target.selectionStart ?? event.target.value.length); }}
          onSelect={event => setCursor(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={event => {
            if (mentionHits[0] && event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              pickMention(mentionHits[0]);
              return;
            }
            if (
              event.key !== "Enter"
              || event.shiftKey
              || event.nativeEvent.isComposing
              || busy
              || loading
              || Boolean(running)
              || !message.trim()
            ) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        {running ? (
          <Button type="button" variant="outline" onClick={() => void stop(running.id)}>{t("companion.stop")}</Button>
        ) : (
          <Button type="submit" variant="solid" disabled={busy || loading || !message.trim()}>
            {busy ? t("common.processing") : t("companion.send")}
            {!busy ? <kbd aria-hidden="true" className="ml-1 rounded bg-card/10 px-1 py-0.5 text-xs font-medium leading-none text-white/70">↵</kbd> : null}
          </Button>
        )}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <input type="checkbox" className="rounded border-slate-300" checked={useMemory} disabled={busy || !settings}
          onChange={event => void toggleMemory(event.target.checked)} />
        {t("companion.useMemory")}
      </label>
    </form>
  </div>;
}
