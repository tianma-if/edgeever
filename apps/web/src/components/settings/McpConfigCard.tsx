import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Copy, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ApiToken } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import {
  ALL_TOKEN_SCOPES,
  buildMcpRemoteConfig,
  copyTextToClipboard,
  getEdgeEverBaseUrl,
  getTokenScopeLabel,
} from "./settings-utils";

interface CreatedTokenNoticeProps {
  token: string;
}

const getNextTokenName = (tokens: ApiToken[]) => {
  const highestNumber = tokens.reduce((highest, token) => {
    const match = token.name.match(/^MCP Token (\d+)$/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return `MCP Token ${highestNumber + 1}`;
};

const CreatedTokenNotice = ({ token }: CreatedTokenNoticeProps) => {
  const { t } = useTranslation();
  const [copiedAction, setCopiedAction] = useState<"token" | "config" | null>(null);

  const handleCopy = async (action: "token" | "config") => {
    const value = action === "token" ? token : buildMcpRemoteConfig(token);
    if (!(await copyTextToClipboard(value))) {
      return;
    }

    setCopiedAction(action);
    window.setTimeout(() => {
      setCopiedAction((current) => (current === action ? null : current));
    }, 1600);
  };

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-900">
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
        {t("mcp.createdTitle")}
      </div>
      <div className="flex flex-col gap-2 xl:flex-row">
        <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-emerald-200 bg-white px-3 font-mono text-xs text-slate-900">
          <span className="min-w-0 truncate">{token}</span>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant="solid"
            className="w-full whitespace-nowrap bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
            type="button"
            onClick={() => void handleCopy("token")}
          >
            {copiedAction === "token" ? t("common.copied") : t("mcp.copyToken")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full whitespace-nowrap border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50 sm:w-auto"
            type="button"
            onClick={() => void handleCopy("config")}
          >
            {copiedAction === "config" ? t("common.copied") : t("mcp.copyConfig")}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs font-medium leading-4 text-emerald-800">{t("mcp.securityWarning")}</p>
    </div>
  );
};

const McpTitleWithHelp = () => {
  const { t } = useTranslation();
  const baseUrl = getEdgeEverBaseUrl();
  const [copied, setCopied] = useState(false);
  const remoteExample = JSON.stringify(
    {
      mcpServers: {
        edgeever: {
          url: `${baseUrl}/mcp`,
          headers: {
            Authorization: t("mcp.bearerPlaceholder"),
          },
        },
      },
    },
    null,
    2
  );

  const handleCopy = async () => {
    if (!(await copyTextToClipboard(remoteExample))) {
      return;
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="w-fit max-w-full">
      <CardTitle className="flex items-center gap-2 text-sm">
        <KeyRound className="h-4 w-4 text-emerald-700" />
        {t("mcp.title")}
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 bg-white px-2.5 text-xs" type="button">
              {t("mcp.example")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl gap-3 p-4 sm:p-5">
            <DialogHeader>
              <DialogTitle className="text-base">{t("mcp.exampleTitle")}</DialogTitle>
            </DialogHeader>
            <pre className="max-h-[55vh] overflow-auto rounded-md border border-slate-100 bg-slate-950 p-3 text-left text-[11px] leading-5 text-slate-100 sm:text-xs">
              <code>{remoteExample}</code>
            </pre>
            <div className="flex justify-end">
              <Button
                size="md"
                variant="solid"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                type="button"
                onClick={() => void handleCopy()}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? t("common.copied") : t("mcp.copyExample")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardTitle>
    </div>
  );
};

interface ScopePickerProps {
  availableScopes: string[];
  selectedScopes: Set<string>;
  onToggleScope: (scope: string) => void;
}

const ScopePicker = ({ availableScopes, selectedScopes, onToggleScope }: ScopePickerProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <Collapsible className="rounded-lg border border-slate-200 bg-white" open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <button className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left" type="button">
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-slate-700">{t("mcp.scopeTitle")}</span>
            <span className="mt-0.5 block text-[11px] font-medium text-slate-400">
              {t("mcp.selectedScopes", { selected: selectedScopes.size, total: availableScopes.length })}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-400 transition-transform",
              expanded ? "rotate-180" : "rotate-0"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2">
        {availableScopes.map((scope) => {
          const checked = selectedScopes.has(scope);
          const checkboxId = `token-scope-${scope.replace(/[^a-z0-9]+/gi, "-")}`;

          return (
            <label
              key={scope}
              htmlFor={checkboxId}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                checked
                  ? "border-emerald-500/30 bg-emerald-50/70 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              <Checkbox
                id={checkboxId}
                checked={checked}
                onCheckedChange={() => onToggleScope(scope)}
                className="border-emerald-300"
              />
              <span className="min-w-0 truncate text-xs font-semibold" title={scope}>
                {getTokenScopeLabel(scope, t)}
              </span>
            </label>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
};

interface TokenListProps {
  tokens: ApiToken[];
  isLoading: boolean;
  isDeleting: boolean;
  onDelete: (token: ApiToken) => void;
}

const TokenList = ({ tokens, isLoading, isDeleting, onDelete }: TokenListProps) => {
  const { t } = useTranslation();
  const [copiedAction, setCopiedAction] = useState<{ tokenId: string; action: "token" | "config" } | null>(null);

  const handleCopy = async (token: ApiToken, action: "token" | "config") => {
    if (!token.token) {
      return;
    }

    const value = action === "token" ? token.token : buildMcpRemoteConfig(token.token);
    if (!(await copyTextToClipboard(value))) {
      return;
    }

    setCopiedAction({ tokenId: token.id, action });
    window.setTimeout(() => {
      setCopiedAction((current) => (current?.tokenId === token.id && current.action === action ? null : current));
    }, 1600);
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
        {t("mcp.loadingTokens")}
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
        {t("mcp.emptyTokens")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tokens.map((token) => (
        <div
          key={token.id}
          className={cn(
            "flex min-h-16 flex-col items-stretch gap-3 rounded-lg border p-3 transition-colors sm:p-4 lg:flex-row lg:items-center",
            token.isRevoked ? "border-slate-100 bg-slate-50/50 opacity-60" : "border-slate-200 bg-white hover:border-slate-300"
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold leading-tight text-slate-900">{token.name}</span>
            <span
              className="mt-2 block w-fit max-w-full truncate rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500"
              title={token.scopes.join(", ")}
            >
              {token.scopes.map((scope) => getTokenScopeLabel(scope, t)).join("、") || t("mcp.noScope")}
            </span>
            <span className="mt-2 block text-[11px] font-medium text-slate-400">
              {token.lastUsedAt ? t("mcp.lastUsedAt", { time: formatDateTime(token.lastUsedAt) }) : t("mcp.neverUsed")}
              {!token.token ? ` · ${t("mcp.legacyTokenHint")}` : ""}
            </span>
          </span>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:items-center">
            <Button
              size="sm"
              variant="outline"
              className="h-9 justify-center whitespace-nowrap bg-white px-3 text-xs"
              title={token.token ? t("mcp.copyToken") : t("mcp.legacyTokenCannotCopy")}
              aria-label={token.token ? t("mcp.copyToken") : t("mcp.legacyTokenCannotCopy")}
              disabled={token.isRevoked || !token.token}
              onClick={() => void handleCopy(token, "token")}
            >
              {copiedAction?.tokenId === token.id && copiedAction.action === "token" ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedAction?.tokenId === token.id && copiedAction.action === "token" ? t("common.copied") : t("mcp.copyToken")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 justify-center whitespace-nowrap bg-white px-3 text-xs"
              title={token.token ? t("mcp.copyConfig") : t("mcp.legacyConfigCannotCopy")}
              aria-label={token.token ? t("mcp.copyConfig") : t("mcp.legacyConfigCannotCopy")}
              disabled={token.isRevoked || !token.token}
              onClick={() => void handleCopy(token, "config")}
            >
              {copiedAction?.tokenId === token.id && copiedAction.action === "config" ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedAction?.tokenId === token.id && copiedAction.action === "config" ? t("common.copied") : t("mcp.copyConfig")}
            </Button>
            <Button
              size="icon"
              variant="danger"
              className="h-9 w-full shrink-0 sm:w-9"
              title={t("mcp.deleteToken")}
              aria-label={t("mcp.deleteToken")}
              disabled={isDeleting}
              onClick={() => onDelete(token)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

export const McpConfigCard = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("MCP Token 1");
  const [isNameCustomized, setIsNameCustomized] = useState(false);
  const nameInitialized = useRef(false);
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(() => new Set(ALL_TOKEN_SCOPES));
  const [scopeDefaultsSynced, setScopeDefaultsSynced] = useState(false);
  const [createdToken, setCreatedToken] = useState<{ token: string; apiToken: ApiToken } | null>(null);
  const [tokenDeleteConfirmation, setTokenDeleteConfirmation] = useState<ApiToken | null>(null);

  const tokensQuery = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api.listApiTokens(),
  });

  const availableScopes = tokensQuery.data?.availableScopes ?? ALL_TOKEN_SCOPES;
  const tokens = tokensQuery.data?.apiTokens ?? [];

  useEffect(() => {
    if (scopeDefaultsSynced || !tokensQuery.data?.availableScopes) {
      return;
    }

    setSelectedScopes(new Set(tokensQuery.data.availableScopes));
    setScopeDefaultsSynced(true);
  }, [scopeDefaultsSynced, tokensQuery.data?.availableScopes]);

  useEffect(() => {
    if (!nameInitialized.current && !isNameCustomized && tokensQuery.data?.apiTokens) {
      setName(getNextTokenName(tokensQuery.data.apiTokens));
      nameInitialized.current = true;
    }
  }, [isNameCustomized, tokensQuery.data?.apiTokens]);

  const createMutation = useMutation({
    mutationFn: api.createApiToken,
    onSuccess: async (data) => {
      setCreatedToken(data);
      setName(getNextTokenName([...tokens, data.apiToken]));
      setIsNameCustomized(true);
      setSelectedScopes(new Set(availableScopes));
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const deleteTokenMutation = useMutation({
    mutationFn: api.revokeApiToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scopes = Array.from(selectedScopes);

    if (!name.trim() || scopes.length === 0) {
      return;
    }

    createMutation.mutate({ name: name.trim(), scopes });
  };

  return (
    <>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4">
          <McpTitleWithHelp />
          <CardDescription className="text-xs leading-4">{t("mcp.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          {createdToken && <CreatedTokenNotice token={createdToken.token} />}

          <form className="min-w-0 space-y-4 rounded-lg border border-slate-100 bg-slate-50/70 p-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                className="h-9 min-w-0 flex-1 text-xs focus-visible:ring-4 focus-visible:ring-emerald-500/10"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setIsNameCustomized(true);
                }}
                placeholder={t("mcp.namePlaceholder")}
              />
              <Button
                size="md"
                variant="solid"
                className="h-9 w-full whitespace-nowrap bg-emerald-500 text-white hover:bg-emerald-600 sm:w-32"
                type="submit"
                disabled={createMutation.isPending}
              >
                <Plus className="h-4 w-4" />
                {t("mcp.createToken")}
              </Button>
            </div>

            <ScopePicker
              availableScopes={availableScopes}
              selectedScopes={selectedScopes}
              onToggleScope={toggleScope}
            />
          </form>

          <div className="space-y-3">
            <span className="block text-xs font-semibold text-slate-500">{t("mcp.activeTokens")}</span>
            <TokenList
              tokens={tokens}
              isLoading={tokensQuery.isLoading}
              isDeleting={deleteTokenMutation.isPending}
              onDelete={setTokenDeleteConfirmation}
            />
          </div>
        </CardContent>
      </Card>

      {tokenDeleteConfirmation && (
        <AppConfirmDialog
          title={t("mcp.deleteConfirmTitle", { name: tokenDeleteConfirmation.name })}
          description={t("mcp.deleteConfirmDescription")}
          confirmLabel={t("mcp.deleteConfirmLabel")}
          isWorking={deleteTokenMutation.isPending}
          tone="danger"
          onCancel={() => setTokenDeleteConfirmation(null)}
          onConfirm={() => {
            deleteTokenMutation.mutate(tokenDeleteConfirmation.id, {
              onSuccess: () => setTokenDeleteConfirmation(null),
            });
          }}
        />
      )}
    </>
  );
};
