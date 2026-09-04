import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ApiToken } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import {
  ALL_TOKEN_SCOPES,
  buildMcpRemoteConfig,
  copyTextToClipboard,
  createDefaultTokenName,
  DEFAULT_TOKEN_ACCESS_LEVEL,
  getEdgeEverBaseUrl,
  getStoredTokenAccessLevel,
  getTokenScopesForAccessLevel,
  getTokenScopeLabel,
  type TokenAccessLevel,
} from "./settings-utils";

const McpExampleDialog = () => {
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
  );
};

interface AccessLevelPickerProps {
  value: TokenAccessLevel;
  onChange: (accessLevel: TokenAccessLevel) => void;
}

const AccessLevelPicker = ({ value, onChange }: AccessLevelPickerProps) => {
  const { t } = useTranslation();
  const options: TokenAccessLevel[] = ["full", "read-only"];

  return (
    <TooltipProvider>
      <div
        role="radiogroup"
        aria-label={t("mcp.accessLevelTitle")}
        className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-200/70 p-0.5"
      >
        {options.map((option) => {
          const checked = value === option;
          const inputId = `token-access-${option}`;

          return (
            <Tooltip key={option}>
              <TooltipTrigger asChild>
                <label
                  htmlFor={inputId}
                  className={cn(
                    "flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium transition-all focus-within:ring-2 focus-within:ring-emerald-500/40",
                    checked
                      ? "bg-white font-semibold text-emerald-800 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <input
                    id={inputId}
                    className="sr-only"
                    type="radio"
                    name="token-access-level"
                    value={option}
                    checked={checked}
                    onChange={() => onChange(option)}
                  />
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", checked ? "bg-emerald-600" : "bg-slate-400")}
                  />
                  {t(`mcp.accessLevels.${option}.label`)}
                </label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72 leading-4 text-xs">
                {t(`mcp.accessLevels.${option}.description`)}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

interface TokenListProps {
  tokens: ApiToken[];
  availableScopes: string[];
  newlyCreatedTokenId: string | null;
  isLoading: boolean;
  isDeleting: boolean;
  onDelete: (token: ApiToken) => void;
}

const TokenList = ({ tokens, availableScopes, newlyCreatedTokenId, isLoading, isDeleting, onDelete }: TokenListProps) => {
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
      <p className="py-4 text-center text-xs text-slate-400">{t("mcp.loadingTokens")}</p>
    );
  }

  if (tokens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
        {t("mcp.emptyTokens")}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
      {tokens.map((token) => {
        const accessLevel = getStoredTokenAccessLevel(token.scopes, availableScopes);
        const accessLabel = accessLevel === "legacy-custom"
          ? t("mcp.accessLevels.legacy-custom.label")
          : t(`mcp.accessLevels.${accessLevel}.label`);

        return (
          <div
            key={token.id}
            className={cn(
              "flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between transition-colors sm:p-4",
              token.isRevoked ? "bg-slate-50/50 opacity-60" : "hover:bg-slate-50/40",
              token.id === newlyCreatedTokenId && "edgeever-token-created",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-xs font-semibold text-slate-900">{token.name}</span>
                {accessLevel === "legacy-custom" ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="cursor-help rounded-md border border-slate-200/80 bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                          tabIndex={0}
                        >
                          {accessLabel}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        {token.scopes.map((scope) => getTokenScopeLabel(scope, t)).join(", ")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-normal",
                      accessLevel === "full"
                        ? "border border-emerald-200/60 bg-emerald-50 text-emerald-700"
                        : "border border-slate-200/80 bg-slate-100 text-slate-600"
                    )}
                  >
                    {accessLabel}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>
                  {token.lastUsedAt ? t("mcp.lastUsedAt", { time: formatDateTime(token.lastUsedAt) }) : t("mcp.neverUsed")}
                </span>
                {!token.token ? (
                  <span className="text-amber-600">· {t("mcp.legacyTokenHint")}</span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 border-slate-200 bg-white px-2.5 text-xs font-normal text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                      aria-label={token.token ? t("mcp.copyToken") : t("mcp.legacyTokenCannotCopy")}
                      disabled={token.isRevoked || !token.token}
                      onClick={() => void handleCopy(token, "token")}
                    >
                      {copiedAction?.tokenId === token.id && copiedAction.action === "token" ? (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="font-medium text-emerald-700">{t("common.copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                          <span>{t("mcp.copyToken")}</span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{token.token ? t("mcp.copyToken") : t("mcp.legacyTokenCannotCopy")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 border-slate-200 bg-white px-2.5 text-xs font-normal text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                      aria-label={token.token ? t("mcp.copyConfig") : t("mcp.legacyConfigCannotCopy")}
                      disabled={token.isRevoked || !token.token}
                      onClick={() => void handleCopy(token, "config")}
                    >
                      {copiedAction?.tokenId === token.id && copiedAction.action === "config" ? (
                        <>
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="font-medium text-emerald-700">{t("common.copied")}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                          <span>{t("mcp.copyConfig")}</span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{token.token ? t("mcp.copyConfig") : t("mcp.legacyConfigCannotCopy")}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label={t("mcp.deleteToken")}
                      disabled={isDeleting}
                      onClick={() => onDelete(token)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("mcp.deleteToken")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const McpConfigCard = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => createDefaultTokenName());
  const [accessLevel, setAccessLevel] = useState<TokenAccessLevel>(DEFAULT_TOKEN_ACCESS_LEVEL);
  const [newlyCreatedTokenId, setNewlyCreatedTokenId] = useState<string | null>(null);
  const [tokenDeleteConfirmation, setTokenDeleteConfirmation] = useState<ApiToken | null>(null);

  const tokensQuery = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api.listApiTokens(),
  });

  const availableScopes = tokensQuery.data?.availableScopes ?? ALL_TOKEN_SCOPES;
  const tokens = tokensQuery.data?.apiTokens ?? [];

  const createMutation = useMutation({
    mutationFn: api.createApiToken,
    onSuccess: async (data) => {
      setNewlyCreatedTokenId(data.apiToken.id);
      setName(createDefaultTokenName());
      setAccessLevel(DEFAULT_TOKEN_ACCESS_LEVEL);
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const deleteTokenMutation = useMutation({
    mutationFn: api.revokeApiToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scopes = getTokenScopesForAccessLevel(accessLevel, availableScopes);

    if (!name.trim()) {
      return;
    }

    createMutation.mutate({ name: name.trim(), scopes });
  };

  return (
    <>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                <KeyRound className={SETTINGS_CARD_ICON_CLASSNAME} />
                {t("mcp.title")}
              </CardTitle>
              <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>{t("mcp.description")}</CardDescription>
            </div>
            <McpExampleDialog />
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 p-4 pt-0 sm:px-5 sm:pb-5">
          <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-3 sm:p-3.5">
            <form className="flex flex-col gap-2.5 sm:flex-row sm:items-center" onSubmit={handleSubmit}>
              <Input
                className="h-9 min-w-0 flex-1 bg-white text-xs"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("mcp.namePlaceholder")}
              />
              <div className="flex flex-wrap items-center gap-2">
                <AccessLevelPicker
                  value={accessLevel}
                  onChange={setAccessLevel}
                />
                <Button
                  size="sm"
                  variant="solid"
                  className="h-9 shrink-0 gap-1 bg-emerald-600 px-3.5 text-xs text-white hover:bg-emerald-700"
                  type="submit"
                  disabled={createMutation.isPending || !name.trim()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("mcp.createToken")}
                </Button>
              </div>
            </form>
          </div>

          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t("mcp.activeTokens")}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {tokens.length}
                </span>
              </div>
            </div>
            <TokenList
              tokens={tokens}
              availableScopes={availableScopes}
              newlyCreatedTokenId={newlyCreatedTokenId}
              isLoading={tokensQuery.isLoading}
              isDeleting={deleteTokenMutation.isPending}
              onDelete={setTokenDeleteConfirmation}
            />
          </section>
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
