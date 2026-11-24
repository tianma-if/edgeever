import { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { Link } from "react-router";
import { WORKSPACE_SETTINGS_PATH } from "@/hooks/useWorkspaceRoute";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AI_SIDEBAR_ADAPTER_PATH_KEY, desktopAcpAutomaticProbeInput, desktopAcpSelectorVisible,
  desktopAcpAvailable, listDesktopAcpAdapters, probeDesktopAcpAdapter, selectAiSidebarAgent,
  type AiSidebarSource, type DesktopAcpAdapterId,
} from "@/lib/desktop-acp";
import { aiErrorMessage, formatProviderOrdinal, isLegacyProviderDisplayName } from "../settings/ai-provider-options";
import { resolveBuiltinAgentModel } from "./builtin-agent-model";
import { AgentLogo } from "./AgentLogo";

export function AiAgentSelector({ source, adapterId, disabled, onPendingChange }: {
  source: AiSidebarSource;
  adapterId: DesktopAcpAdapterId | null;
  disabled: boolean;
  noteContext?: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const settings = useQuery({ queryKey: ["ai-settings", locale], queryFn: () => api.getAiSettings(locale), staleTime: 30_000 });
  const desktop = desktopAcpAvailable();
  const agents = useQuery({
    queryKey: ["ai-sidebar-adapters"],
    queryFn: listDesktopAcpAdapters,
    enabled: desktop,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const customPath = desktop ? window.localStorage.getItem(AI_SIDEBAR_ADAPTER_PATH_KEY) ?? "" : "";
  const listedAgents = (agents.data ?? []).filter((agent) => desktopAcpSelectorVisible(agent, customPath));
  const probeInputs = listedAgents.map((agent) => desktopAcpAutomaticProbeInput(agent, customPath));
  const probes = useQueries({
    queries: listedAgents.map((agent, index) => ({
      queryKey: ["ai-sidebar-adapter-probe", agent.id, agent.version ?? "", probeInputs[index]?.path ?? ""],
      queryFn: () => probeDesktopAcpAdapter(probeInputs[index]!),
      // Listing connectors must not launch third-party processes at startup.
      // Their handshake (and any subprocesses they create) belongs to opening
      // the selector; sending a prompt also establishes its own connection.
      enabled: desktop && open && probeInputs[index] !== null,
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  // Each connector finishes independently, so a slow agent cannot block another.
  const localAgents = listedAgents.map((agent, index) => probeInputs[index]
    ? probes[index].isError ? { ...agent, state: "failed" as const, detail: "connection_failed" } : probes[index].data ?? agent
    : agent);
  const mutation = useMutation({
    mutationFn: async (value: string) => {
      if (value.startsWith("agent:")) {
        const id = value.slice(6) as DesktopAcpAdapterId;
        if (!localAgents.some((agent) => agent.id === id && agent.state === "available")) throw new Error(t("aiAssistant.agentSource.switchUnavailable"));
        selectAiSidebarAgent("local", id);
      } else {
        if (value !== "builtin" && value.slice(6) !== settings.data?.defaultModelId) {
          const updated = await api.updateDefaultAiModel(value.slice(6));
          queryClient.setQueryData(["ai-settings", locale], updated);
          await queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
        }
        selectAiSidebarAgent("builtin");
      }
    },
    onSuccess: () => setOpen(false),
  });
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const builtin = resolveBuiltinAgentModel(settings.data);
  const provider = settings.data?.providers.find((item) => item.models.some((model) => model.id === settings.data?.defaultModelId));
  const modelLabel = [provider?.displayName, builtin?.label].filter(Boolean).join(" · ") || t("aiModel.noDefaultModel");
  const label = source === "local"
    ? (adapterId ? t(`aiAssistant.agentSource.${adapterId}`) : t("aiAssistant.agentSource.local"))
    : `${t("aiAssistant.agentSource.builtin")} · ${modelLabel}`;
  const buttonLabel = source === "local" ? label : builtin?.label ?? t("aiModel.noDefaultModel");
  const selected = source === "local" ? `agent:${adapterId}` : settings.data?.defaultModelId ? `model:${settings.data.defaultModelId}` : "builtin";
  const providers = (settings.data?.providers ?? []).map((provider, index) => {
    const name = !provider.displayName || isLegacyProviderDisplayName(provider.displayName, provider.provider)
      ? t("aiModel.defaultProviderName", { ordinal: formatProviderOrdinal(index + 1, locale) }) : provider.displayName;
    return { ...provider, name };
  }).filter((provider) => provider.models.length);
  const choose = (value: string) => {
    if (disabled || mutation.isPending) return;
    if (value.startsWith("agent:")) {
      const index = localAgents.findIndex((agent) => agent.id === value.slice(6));
      if (index < 0 || localAgents[index].state !== "available" || (probeInputs[index] !== null && probes[index].isPending)) return;
    }
    if (value === selected) { setOpen(false); return; }
    onPendingChange(true);
    void mutation.mutateAsync(value).catch(() => undefined).finally(() => onPendingChange(false));
  };

  return (
    <div className="min-w-0 max-w-44 flex-1">
      <DropdownMenu open={open} onOpenChange={(next) => {
        if (mutation.isPending) return;
        setOpen(next);
        if (next) {
          mutation.reset();
          void settings.refetch();
          if (desktop && agents.isStale) void agents.refetch();
          probes.forEach((probe, index) => {
            if (probeInputs[index] !== null && probe.isStale) void probe.refetch();
          });
        }
      }}>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled || mutation.isPending}
            aria-label={`${t("aiAssistant.agentSource.switch")} · ${label}`}
            className="flex w-full min-w-0 items-center gap-1 rounded-full px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50">
            {source === "local" && adapterId ? <AgentLogo id={adapterId} /> : null}
            <span className="truncate">{buttonLabel}</span>
            {mutation.isPending ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <ChevronDown className="size-3 shrink-0" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-80 max-w-[calc(100vw-24px)]">
          {settings.isError || mutation.isError ? <p role="alert" className="px-2 py-1 text-xs text-rose-600">{aiErrorMessage(mutation.error ?? settings.error, t("aiAssistant.agentSource.switchUnavailable"), t("aiModel.encryptionKeyMissing"), t("aiModel.savedCredentialsUnavailable"))}</p> : null}
          <div className="max-h-72 overflow-y-auto">
            <DropdownMenuRadioGroup value={selected} onValueChange={choose}>
              <DropdownMenuLabel>{t("aiAssistant.agentSource.builtin")}</DropdownMenuLabel>
              {source === "local" && !providers.length ? <DropdownMenuRadioItem value="builtin" disabled={mutation.isPending} onSelect={(event) => event.preventDefault()}>{t("aiAssistant.agentSource.builtin")}</DropdownMenuRadioItem> : null}
              {settings.isPending ? <p className="px-2 py-2 text-xs">{t("common.loading")}</p> : null}
              {providers.flatMap((provider) => provider.models.map((model) => <DropdownMenuRadioItem key={model.id} value={`model:${model.id}`}
                disabled={mutation.isPending || settings.data?.readOnly || !settings.data?.encryptionConfigured || !provider.isEnabled || provider.credentialsUnavailable}
                onSelect={(event) => event.preventDefault()}>
                <span className="min-w-0 break-words">{provider.name} · {model.displayName || model.modelId}{!provider.isEnabled || provider.credentialsUnavailable ? <span className="ml-2 text-[10px] text-slate-500">{t("aiAssistant.agentSource.optionUnavailable")}</span> : null}</span>
              </DropdownMenuRadioItem>))}
              {!settings.isPending && !providers.length ? <p className="px-2 py-2 text-xs text-slate-500">{t("aiAssistant.agentSource.noModels")}</p> : null}
              {desktop ? <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("aiAssistant.agentSource.local")}</DropdownMenuLabel>
                {agents.isPending ? <p className="px-2 py-2 text-xs">{t("common.loading")}</p> : null}
                {agents.isError ? <p role="alert" className="px-2 py-2 text-xs text-rose-600">{t("aiAssistant.agentSource.switchUnavailable")}</p> : null}
                <TooltipProvider>
                  {localAgents.map((agent, index) => {
                    if (!desktopAcpSelectorVisible(agent, customPath)) return null;
                    const checking = probeInputs[index] !== null && probes[index].isPending;
                    const available = !checking && agent.state === "available";
                    const status = checking ? t("aiAssistant.agentSource.probing") : t(`aiAssistant.agentSource.states.${agent.state}`);
                    const name = t(`aiAssistant.agentSource.${agent.id}`);
                    return <Tooltip key={agent.id}>
                      <TooltipTrigger asChild>
                        <DropdownMenuRadioItem value={`agent:${agent.id}`} disabled={mutation.isPending}
                          aria-disabled={!available || mutation.isPending} aria-label={`${name} · ${status}`}
                          className="aria-disabled:text-slate-400" onSelect={(event) => event.preventDefault()}>
                          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2"><AgentLogo id={agent.id} /><span className="min-w-0 break-words">{name}</span></span>
                            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${available ? "bg-[#16A06E]" : "bg-amber-500"} ${checking ? "motion-safe:animate-pulse" : ""}`} />
                          </span>
                        </DropdownMenuRadioItem>
                      </TooltipTrigger>
                      <TooltipContent side="left">{status}</TooltipContent>
                    </Tooltip>;
                  })}
                </TooltipProvider>
                {!agents.isPending && !agents.isError && !localAgents.length ? <p className="px-2 py-2 text-xs text-slate-500">{t("aiAssistant.agentSource.switchUnavailable")}</p> : null}
              </> : null}
            </DropdownMenuRadioGroup>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild disabled={mutation.isPending}>
            <Link to={`${WORKSPACE_SETTINGS_PATH}?tab=ai`}>{t("aiAssistant.agentSource.configure")}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
