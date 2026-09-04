import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, MessageCircle } from "lucide-react";
import type { CompanionAction, CompanionMemory, CompanionTurn } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import { api, ApiRequestError } from "@/lib/api";
import { CompanionActionCard } from "./CompanionActionCard";

type CompanionActionHandlers = {
  beforeApply: () => Promise<void>;
  onNotesChanged: () => Promise<void>;
  onOpenNote: (id: string, notebookId: string) => void;
};

export default function CompanionPane({ available, onBack, onOpenSettings, ...actionHandlers }: {
  available: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
} & CompanionActionHandlers) {
  const { t } = useTranslation();
  return <section className="flex h-full min-h-0 flex-col bg-white" aria-labelledby="companion-title">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />{t("companion.backToNotes")}
        </Button>
        <h1 id="companion-title" className="text-sm font-semibold text-slate-900">{t("companion.title")}</h1>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{t("companion.preview")}</span>
      </div>
      <Button variant="ghost" size="sm" onClick={onOpenSettings}>{t("companion.settings")}</Button>
    </header>
    {available ? <CompanionWorkspace {...actionHandlers} /> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center">
      <MessageCircle aria-hidden="true" className="h-10 w-10 text-emerald-600" />
      <h2 className="text-lg font-semibold text-slate-900">{t("companion.emptyTitle")}</h2>
      <p className="max-w-lg text-sm leading-relaxed text-slate-500">{t("companion.intro")}</p>
      <p role="status" className="max-w-lg rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">{t("companion.unavailableHelp")}</p>
    </div>}
  </section>;
}

function CompanionWorkspace({ beforeApply, onNotesChanged, onOpenNote }: CompanionActionHandlers) {
  const { t, i18n } = useTranslation();
  const [memories, setMemories] = useState<CompanionMemory[]>([]);
  const [turns, setTurns] = useState<CompanionTurn[]>([]);
  const [actions, setActions] = useState<CompanionAction[]>([]);
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [editing, setEditing] = useState<CompanionMemory | null>(null);
  const [useMemory, setUseMemory] = useState(true);
  const [allowNotes, setAllowNotes] = useState(false);
  const [tab, setTab] = useState<"chat" | "memories">("chat");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<CompanionMemory | "history" | null>(null);
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const explainError = (cause: unknown) => {
    const code = cause instanceof ApiRequestError ? cause.code : "";
    if (code === "ai_not_configured") return t("companion.configureModel");
    if (code === "companion_memory_conflict") return t("companion.conflict");
    if (code === "companion_history_full") return t("companion.historyFull");
    if (code === "companion_action_conflict") return t("companion.actions.conflict");
    if (code === "companion_action_unsynced") return t("companion.actions.unsynced");
    if (code === "companion_action_uncertain") return t("companion.actions.status.uncertain");
    if (cause instanceof ApiRequestError && cause.status === 403) return t("companion.unavailable");
    return t("companion.failed");
  };
  const reload = async () => {
    const [memoryResult, turnResult, actionResult] = await Promise.all([api.listCompanionMemories(), api.listCompanionTurns(), api.listCompanionActions()]);
    if (!alive.current) return;
    setMemories(memoryResult.memories);
    setTurns(turnResult.turns);
    setActions(actionResult.actions);
  };
  useEffect(() => {
    alive.current = true;
    void reload().catch(cause => { if (alive.current) setError(explainError(cause)); })
      .finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; active.current?.controller.abort(); };
    // This workspace owns ephemeral account-scoped state, discarded on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const perform = async (work: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(null);
    try { await work(); await reload(); }
    catch (cause) { if (alive.current) setError(explainError(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || locked.current) return;
    void perform(async () => {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      active.current = { id, controller };
      setMessage("");
      setTurns(previous => [{ id, threadId, message: text, response: "", status: "running", sources: [], model: "",
        inputTokens: null, outputTokens: null, createdAt: new Date().toISOString() }, ...previous]);
      let completed = false;
      try {
        await api.streamCompanion({ id, threadId, message: text, useMemory, allowNotes,
          locale: i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en-US" }, {
          signal: controller.signal,
          onEvent: event => {
            if (!alive.current) return;
            if (event.type === "text-delta") setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, response: turn.response + event.text } : turn));
            if (event.type === "done") {
              completed = true;
              setTurns(previous => previous.map(turn => turn.id === id ? event.turn : turn));
            }
            if (event.type === "error") setError(t("companion.failed"));
          },
        });
        if (!completed && alive.current) setError(t("companion.recovered"));
      } catch (cause) {
        if (alive.current) setError(controller.signal.aborted ? t("companion.recovered") : explainError(cause));
      } finally {
        active.current = null;
        // Recover by ID; never retry a billable generation automatically.
        if (alive.current) {
          try {
            const { turn } = await api.getCompanionTurn(id);
            setTurns(previous => previous.map(item => item.id === id ? turn : item));
          } catch {
            setTurns(previous => previous.filter(item => item.id !== id));
            setMessage(text);
          }
        }
      }
    });
  };
  const stop = async (id: string) => {
    try { await api.cancelCompanionTurn(id); active.current?.controller.abort(); await reload(); }
    catch (cause) { if (alive.current) setError(explainError(cause)); }
  };
  const applyAction = (action: CompanionAction) => void perform(async () => {
    await beforeApply();
    try {
      const result = await api.applyCompanionAction(action.id);
      if (alive.current) setActions(previous => previous.map(item => item.id === action.id ? result.action : item));
      // A refresh failure is not a mutation failure. The applied receipt remains
      // visible, and retrying the same ID can only recover the original result.
      try { await onNotesChanged(); }
      catch { if (alive.current) setError(t(result.action.status === "applied" ? "companion.actions.syncFailed" : "companion.actions.status.uncertain")); }
    } finally {
      await reload().catch(() => {});
    }
  });
  const saveMemory = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      if (editing) await api.updateCompanionMemory(editing, memoryContent.trim());
      else await api.saveCompanionMemory(memoryContent.trim());
      setEditing(null); setMemoryContent("");
    });
  };
  const exportData = () => void perform(async () => {
    const data = await api.exportCompanion();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "edgeever-companion.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const threads = [...new Map(turns.map(turn => [turn.threadId, turn])).values()];
  const running = turns.find(turn => turn.status === "running");

  return <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3 overflow-hidden px-4 py-4 lg:px-8 lg:py-6">
      <div className="flex flex-wrap gap-2">
        <Button aria-pressed={tab === "chat"} variant={tab === "chat" ? "solid" : "outline"} onClick={() => setTab("chat")}>{t("companion.chat")}</Button>
        <Button aria-pressed={tab === "memories"} variant={tab === "memories" ? "solid" : "outline"} onClick={() => setTab("memories")}>{t("companion.memories")} ({memories.length}/50)</Button>
        <Button variant="ghost" disabled={busy || loading} onClick={() => void perform(reload)}>{t("common.refresh")}</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      {loading ? <p role="status">{t("common.loading")}</p> : null}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {tab === "chat" ? <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select value={threadId} disabled={busy} onValueChange={setThreadId}>
                <SelectTrigger aria-label={t("companion.history")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!threads.some(thread => thread.threadId === threadId) ? <SelectItem value={threadId}>{t("companion.newChat")}</SelectItem> : null}
                  {threads.map(thread => <SelectItem key={thread.threadId} value={thread.threadId}>{thread.message.slice(0, 40)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => { setThreadId(crypto.randomUUID()); setMessage(""); }}>{t("companion.newChat")}</Button>
          </div>
          <div className="space-y-4" aria-busy={busy}>
            {!loading && !turns.some(turn => turn.threadId === threadId) ? <div className="space-y-3 py-10 text-center">
              <MessageCircle aria-hidden="true" className="mx-auto h-9 w-9 text-emerald-600" />
              <h2 className="text-lg font-semibold text-slate-900">{t("companion.emptyTitle")}</h2>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-500">{t("companion.intro")}</p>
            </div> : null}
            {turns.filter(turn => turn.threadId === threadId).reverse().map(turn => <article key={turn.id} className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="whitespace-pre-wrap break-words font-medium">{turn.message}</p>
              <p className="whitespace-pre-wrap break-words leading-relaxed">{turn.response || t("companion.waiting")}</p>
              <p className="text-xs text-slate-500">{t(`companion.status.${turn.status}`)}{turn.model ? ` · ${turn.model}` : ""}</p>
              {turn.sources.length ? <ul className="list-inside list-disc text-xs text-slate-500">{turn.sources.map(source => <li key={source.id}>{source.title || t("common.untitledMemo")} · r{source.revision} · {source.id}</li>)}</ul> : null}
              {actions.filter(action => action.turnId === turn.id).map(action => <CompanionActionCard key={action.id} action={action}
                busy={busy || Boolean(running)} onApply={applyAction} onDismiss={item => void perform(() => api.dismissCompanionAction(item.id))} onOpenNote={onOpenNote} />)}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" disabled={busy || Boolean(running) || turn.message.length > 500 || memories.length >= 50 || memories.some(memory => memory.sourceTurnId === turn.id)}
                  onClick={() => void perform(() => api.saveCompanionMemory(turn.message, turn.id))}>{t("companion.rememberMessage")}</Button>
                {turn.status === "running" ? <Button size="sm" variant="outline" onClick={() => void stop(turn.id)}>{t("companion.stop")}</Button> : null}
              </div>
            </article>)}
          </div>
        </> : <>
          <p className="text-sm text-slate-500">{t("companion.memoryHelp")}</p>
          <form className="space-y-2" onSubmit={saveMemory}>
            <label className="block text-sm" htmlFor="companion-memory">{editing ? t("companion.correct") : t("companion.addMemory")}</label>
            <Input id="companion-memory" value={memoryContent} maxLength={500} required disabled={busy || Boolean(running)} onChange={e => setMemoryContent(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || loading || Boolean(running) || !memoryContent.trim()}>{t("common.save")}</Button>
              {editing ? <Button variant="ghost" onClick={() => { setEditing(null); setMemoryContent(""); }}>{t("common.cancel")}</Button> : null}
            </div>
          </form>
          {memories.map(memory => <article key={memory.id} className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="whitespace-pre-wrap break-words">{memory.content}</p>
            <p className="text-xs text-slate-500">{t(memory.sourceTurnId ? "companion.fromMessage" : "companion.fromManual")}</p>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(memory); setMemoryContent(memory.content); }}>{t("companion.correct")}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmation(memory)}>{t("companion.forget")}</Button>
          </article>)}
          <p className="text-xs text-slate-500">{t("companion.backupHelp")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || loading} onClick={exportData}>{t("companion.export")}</Button>
            <Button variant="outline" disabled={busy || loading || Boolean(running)} onClick={() => fileInput.current?.click()}>{t("companion.import")}</Button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label={t("companion.import")} onChange={event => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (file) void perform(async () => {
                if (file.size > 10 * 1024 * 1024) throw new Error("File too large");
                const data = JSON.parse(await file.text()) as { version: number; memories: { content: string }[] };
                if (data.version !== 1 || !Array.isArray(data.memories)) throw new Error("Invalid backup");
                await api.importCompanionMemories(data.memories.map(memory => ({ content: memory.content })));
              });
            }} />
            <Button variant="outline" disabled={busy || loading} onClick={() => setConfirmation("history")}>{t("companion.clearHistory")}</Button>
          </div>
        </>}
      </div>
      {tab === "chat" ? <form onSubmit={send} className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={useMemory} disabled={busy} onCheckedChange={checked => setUseMemory(checked === true)} />{t("companion.useMemory")}</label>
          <label className="flex items-center gap-2"><Checkbox checked={allowNotes} disabled={busy} onCheckedChange={checked => setAllowNotes(checked === true)} />{t("companion.allowNotes")}</label>
        </div>
        <details className="text-xs leading-relaxed text-slate-500">
          <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">{t("companion.privacyTitle")}</summary>
          <p className="mt-2">{t("companion.privacy")}</p>
          <p className="mt-2">{t("companion.contextHelp")}</p>
        </details>
        <label className="sr-only" htmlFor="companion-message">{t("companion.message")}</label>
        <textarea id="companion-message" className="min-h-20 max-h-40 w-full resize-y rounded-md border p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" maxLength={4000} value={message} disabled={busy} placeholder={t("companion.message")} onChange={e => setMessage(e.target.value)} />
        <div className="flex justify-end gap-2">
          {running ? <Button type="button" variant="outline" onClick={() => void stop(running.id)}>{t("companion.stop")}</Button> : null}
          <Button type="submit" disabled={busy || loading || Boolean(running) || !message.trim()}>{busy ? t("common.processing") : t("companion.send")}</Button>
        </div>
      </form> : null}
      {confirmation ? <AppConfirmDialog title={t(confirmation === "history" ? "companion.clearHistory" : "companion.forget")}
        description={t(confirmation === "history" ? "companion.clearHelp" : "companion.forgetHelp")} confirmLabel={t("common.delete")} isWorking={busy}
        onCancel={() => setConfirmation(null)} onConfirm={() => void perform(async () => {
          if (confirmation === "history") { await api.clearCompanionHistory(); setThreadId(crypto.randomUUID()); }
          else await api.forgetCompanionMemory(confirmation);
          setConfirmation(null); setEditing(null); setMemoryContent("");
        })} /> : null}
  </div>;
}
