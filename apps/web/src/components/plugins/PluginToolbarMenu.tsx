import { useEffect, useState, useSyncExternalStore } from "react";
import { Clock3, LoaderCircle, PanelRightOpen, Play, Puzzle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PluginPanelDialog } from "@/components/plugins/PluginPanelDialog";
import { cn } from "@/lib/utils";
import type {
  EdgeEverPluginHost,
  RegisteredPluginAction,
  RegisteredPluginPanel,
} from "@/lib/plugins/plugin-host";

const actionKey = (action: RegisteredPluginAction) => `${action.type}:${action.pluginId}:${action.id}`;

export const PluginToolbarMenu = ({ host, onManage, align = "end", className }: {
  host: EdgeEverPluginHost;
  onManage: () => void;
  align?: "start" | "center" | "end";
  className?: string;
}) => {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<RegisteredPluginPanel | null>(null);
  const activePanelPluginId = activePanel?.pluginId ?? null;
  const activePanelId = activePanel?.id ?? null;

  const groups = snapshot.extensions.flatMap((extension) => {
    if (!extension.enabled || extension.manifest.type !== "plugin") return [];
    const actions: RegisteredPluginAction[] = [
      ...snapshot.commands.filter((command) => command.pluginId === extension.manifest.id).map((command) => ({ ...command, type: "command" as const })),
      ...snapshot.panels.filter((panel) => panel.pluginId === extension.manifest.id).map((panel) => ({ ...panel, type: "panel" as const })),
    ];
    return actions.length ? [{ pluginId: extension.manifest.id, name: extension.manifest.name, actions }] : [];
  });
  const hasActions = groups.length > 0;
  const pluginNames = new Map(snapshot.extensions.map((extension) => [extension.manifest.id, extension.manifest.name]));
  const activePanelRegistered = Boolean(activePanelPluginId && activePanelId && snapshot.panels.some(
    (panel) => panel.pluginId === activePanelPluginId && panel.id === activePanelId
  ));

  useEffect(() => {
    if (activePanelId && activePanelPluginId && !activePanelRegistered) setActivePanel(null);
  }, [activePanelId, activePanelPluginId, activePanelRegistered]);

  const openPanel = (action: RegisteredPluginAction) => {
    const panel = snapshot.panels.find((item) => item.pluginId === action.pluginId && item.id === action.id);
    if (!panel) return;
    setOpen(false);
    setActivePanel(panel);
  };

  const runAction = async (action: RegisteredPluginAction) => {
    if (action.type === "panel") {
      openPanel(action);
      return;
    }
    const key = actionKey(action);
    setPendingAction(key);
    setError(null);
    try {
      await host.runCommand(action.pluginId, action.id);
      setOpen(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setPendingAction(null);
    }
  };

  const renderAction = (action: RegisteredPluginAction, prefix: string, pluginName?: string) => {
    const key = actionKey(action);
    return (
      <DropdownMenuItem
        key={`${prefix}:${key}`}
        className="gap-2"
        disabled={pendingAction !== null}
        onSelect={(event) => {
          event.preventDefault();
          void runAction(action);
        }}
      >
        {pendingAction === key ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-emerald-600" />
        ) : action.type === "panel" ? (
          <PanelRightOpen className="h-4 w-4 text-slate-500" />
        ) : (
          <Play className="h-4 w-4 text-slate-500" />
        )}
        <span className="min-w-0 flex-1 truncate">{action.title}</span>
        {pluginName ? <span className="max-w-24 truncate text-[10px] text-slate-400">{pluginName}</span> : null}
      </DropdownMenuItem>
    );
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setError(null); }}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  className={cn("relative hidden h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-500/70 lg:inline-flex", className)}
                  size="icon"
                  variant="ghost"
                  aria-label={t("plugins.toolbar.open")}
                >
                  <Puzzle className="h-4 w-4" />
                  {hasActions ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-white" aria-hidden="true" /> : null}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("plugins.toolbar.open")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent align={align} className="w-72">
          {snapshot.recentActions.length ? (
            <>
              <DropdownMenuLabel className="flex items-center gap-2 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5" />
                {t("plugins.toolbar.recent")}
              </DropdownMenuLabel>
              {snapshot.recentActions.map((action) => renderAction(action, "recent", pluginNames.get(action.pluginId)))}
              <DropdownMenuSeparator />
            </>
          ) : null}

          {hasActions ? groups.map((group, index) => (
            <div key={group.pluginId}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="truncate text-xs text-slate-500">{group.name}</DropdownMenuLabel>
              {group.actions.map((action) => renderAction(action, group.pluginId))}
            </div>
          )) : (
            <div className="px-2 py-5 text-center text-xs leading-5 text-slate-500">{t("plugins.toolbar.empty")}</div>
          )}

          {error ? <div role="alert" className="mx-1 my-1 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{error}</div> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2" onSelect={() => { setOpen(false); onManage(); }}>
            <Settings2 className="h-4 w-4 text-slate-500" />
            {t("plugins.toolbar.manage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PluginPanelDialog host={host} panel={activePanel} onClose={() => setActivePanel(null)} />
    </>
  );
};
