import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Plus, Search, Sparkles } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChatThreadSummary } from "@/lib/local-agent-threads";

const THREAD_RECENCY_MS = 30 * 24 * 60 * 60 * 1000;

const sidebarThreadLabel = (title: string) => {
  const clause = title.split(/[，。！？!?；;：:\n]/)[0]?.trim() || title;
  return clause.length >= 2 ? clause : title;
};

export function AiSidebarThreadMenu({
  threads,
  threadId,
  title,
  onSelect,
  onCreate,
  pinned,
  pinnedActive = false,
  onSelectPinned,
}: {
  threads: ChatThreadSummary[];
  threadId: string;
  title: string;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
  pinned?: { id: string; title: string } | null;
  pinnedActive?: boolean;
  onSelectPinned?: () => void;
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
  const pinnedVisible = Boolean(pinned && (!normalized || pinned.title.toLocaleLowerCase().includes(normalized)));

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
        {pinned && pinnedVisible ? (
          <DropdownMenuItem className="justify-between gap-3 py-2 text-sm" onSelect={onSelectPinned}>
            <span className="truncate">{pinned.title}</span>
            {pinnedActive ? <Check className="size-4 shrink-0 text-slate-700" aria-hidden="true" /> : <span className="size-4 shrink-0" aria-hidden="true" />}
          </DropdownMenuItem>
        ) : null}
        {threads.length || pinnedVisible ? <DropdownMenuSeparator /> : null}
        {renderGroup(t("aiAssistant.sidebar.historyRecent"), recent, searchOnRecent && !searching)}
        {renderGroup(t("aiAssistant.sidebar.historyOlder"), older, !searchOnRecent && !searching)}
        {normalized && !visible.length ? (
          <p className="px-2 py-3 text-sm text-slate-500">{t("aiAssistant.sidebar.historyEmpty")}</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
