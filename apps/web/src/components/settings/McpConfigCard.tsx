import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { ApiToken, Notebook, TokenNotebookAccess, TokenNotebookDefaultAccess } from "@edgeever/shared";
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
  buildNotebookTreeRows,
  copyTextToClipboard,
  createDefaultTokenName,
  DEFAULT_TOKEN_ACCESS_LEVEL,
  describeNotebookAccess,
  draftToNotebookAccess,
  emptyNotebookGrantDraft,
  getMcpRemoteServerUrl,
  getStoredTokenAccessLevel,
  getTokenScopesForAccessLevel,
  getTokenScopeLabel,
  notebookAccessToDraft,
  type NotebookGrantDraft,
  type TokenAccessLevel,
} from "./settings-utils";

const McpExampleDialog = () => {
  const { t } = useTranslation();
  const serverUrl = getMcpRemoteServerUrl();
  const [copied, setCopied] = useState(false);
  const remoteExample = JSON.stringify(
    {
      mcpServers: {
        edgeever: {
          url: serverUrl,
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
        <Button size="sm" variant="outline" className="h-7 bg-card px-2.5 text-xs" type="button">
          {t("mcp.example")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl gap-3 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>{t("mcp.exampleTitle")}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[55vh] overflow-auto rounded-md border border-slate-100 bg-slate-950 p-3 text-left text-xs leading-5 text-slate-100 sm:text-xs">
          <code>{remoteExample}</code>
        </pre>
        <div className="flex justify-end">
          <Button
            size="md"
            variant="solid"
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

const AccessLevelPicker = ({ value, onChange, name = "token-access-level" }: AccessLevelPickerProps & { name?: string }) => {
  const { t } = useTranslation();
  const options: TokenAccessLevel[] = ["full", "read-only", "custom"];

  return (
    <TooltipProvider>
      <div
        role="radiogroup"
        aria-label={t("mcp.accessLevelTitle")}
        className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-200/70 p-0.5"
      >
        {options.map((option) => {
          const checked = value === option;
          const inputId = `${name}-${option}`;

          return (
            <Tooltip key={option}>
              <TooltipTrigger asChild>
                <label
                  htmlFor={inputId}
                  className={cn(
                    "flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-normal transition-all focus-within:ring-2 focus-within:ring-slate-900/15",
                    checked
                      ? "bg-card text-slate-950 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <input
                    id={inputId}
                    className="sr-only"
                    type="radio"
                    name={name}
                    value={option}
                    checked={checked}
                    onChange={() => onChange(option)}
                  />
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", checked ? "bg-slate-950" : "bg-slate-400")}
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

interface NotebookGrantEditorProps {
  notebooks: Notebook[];
  draft: NotebookGrantDraft;
  onChange: (draft: NotebookGrantDraft) => void;
  idPrefix: string;
}

const NotebookGrantEditor = ({ notebooks, draft, onChange, idPrefix }: NotebookGrantEditorProps) => {
  const { t } = useTranslation();
  const treeRows = useMemo(() => buildNotebookTreeRows(notebooks), [notebooks]);
  const grantedCount = Object.values(draft.grants).filter((grant) => grant.read || grant.write).length;

  const setGrant = (notebookId: string, patch: { read?: boolean; write?: boolean }) => {
    const current = draft.grants[notebookId] ?? { read: false, write: false };
    const next = { ...current, ...patch };
    // Write always implies read, both in the UI and on the server.
    if (next.write) next.read = true;
    const grants = { ...draft.grants };
    if (next.read || next.write) {
      grants[notebookId] = next;
    } else {
      delete grants[notebookId];
    }
    onChange({ mode: "selected", grants, defaultAccess: draft.defaultAccess });
  };

  const setAllGrants = (grant: { read: boolean; write: boolean } | null) => {
    if (!grant) {
      onChange({ mode: "selected", grants: {}, defaultAccess: draft.defaultAccess });
      return;
    }
    const grants: NotebookGrantDraft["grants"] = {};
    for (const { notebook } of treeRows) {
      grants[notebook.id] = grant;
    }
    onChange({ mode: "selected", grants, defaultAccess: draft.defaultAccess });
  };

  return (
    <div className="grid gap-2.5">
      <TooltipProvider>
        <div
          role="radiogroup"
          aria-label={t("mcp.notebookAccessTitle")}
          className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-200/70 p-0.5 self-start"
        >
          {(["all", "selected"] as const).map((mode) => {
            const checked = draft.mode === mode;
            const inputId = `${idPrefix}-notebook-mode-${mode}`;
            return (
              <label
                key={mode}
                htmlFor={inputId}
                className={cn(
                  "flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-normal transition-all focus-within:ring-2 focus-within:ring-slate-900/15",
                  checked ? "bg-card text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900",
                )}
              >
                <input
                  id={inputId}
                  className="sr-only"
                  type="radio"
                  name={`${idPrefix}-notebook-mode`}
                  value={mode}
                  checked={checked}
                  onChange={() => onChange(mode === "all" ? emptyNotebookGrantDraft() : { mode: "selected", grants: draft.grants, defaultAccess: draft.defaultAccess })}
                />
                <span
                  aria-hidden="true"
                  className={cn("h-1.5 w-1.5 rounded-full", checked ? "bg-slate-950" : "bg-slate-400")}
                />
                {t(mode === "all" ? "mcp.notebookAccessAll" : "mcp.notebookAccessSelected")}
              </label>
            );
          })}
        </div>
      </TooltipProvider>

      {draft.mode === "selected" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-500">{t("mcp.notebookAccessHint", { count: grantedCount })}</p>
            <span className="flex-1" />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" type="button" onClick={() => setAllGrants({ read: true, write: false })}>
                    {t("mcp.notebookBulkRead")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-72 leading-4 text-xs">{t("mcp.notebookBulkReadDescription")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" type="button" onClick={() => setAllGrants({ read: true, write: true })}>
                    {t("mcp.notebookBulkWrite")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-72 leading-4 text-xs">{t("mcp.notebookBulkWriteDescription")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" type="button" onClick={() => setAllGrants(null)}>
                    {t("mcp.notebookBulkClear")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-72 leading-4 text-xs">{t("mcp.notebookBulkClearDescription")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-card">
            {treeRows.map(({ notebook, depth }) => {
              const grant = draft.grants[notebook.id] ?? { read: false, write: false };
              return (
                <div
                  key={notebook.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                  style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-800">{notebook.name}</span>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-slate-600">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-900"
                        checked={grant.read}
                        disabled={grant.write}
                        onChange={(event) => setGrant(notebook.id, { read: event.target.checked })}
                      />
                      {t("mcp.notebookRead")}
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-900"
                        checked={grant.write}
                        onChange={(event) => setGrant(notebook.id, { write: event.target.checked })}
                      />
                      {t("mcp.notebookWrite")}
                    </label>
                  </div>
                </div>
              );
            })}
            {treeRows.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-400">{t("mcp.notebookAccessEmpty")}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-normal text-slate-600">{t("mcp.notebookDefaultAccessTitle")}</span>
            <TooltipProvider>
              <div
                role="radiogroup"
                aria-label={t("mcp.notebookDefaultAccessTitle")}
                className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-200/70 p-0.5 self-start"
              >
                {(["none", "read", "write"] as const).map((option) => {
                  const checked = draft.defaultAccess === option;
                  const inputId = `${idPrefix}-notebook-default-${option}`;
                  return (
                    <Tooltip key={option}>
                      <TooltipTrigger asChild>
                        <label
                          htmlFor={inputId}
                          className={cn(
                            "flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-normal transition-all focus-within:ring-2 focus-within:ring-slate-900/15",
                            checked ? "bg-card text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900",
                          )}
                        >
                          <input
                            id={inputId}
                            className="sr-only"
                            type="radio"
                            name={`${idPrefix}-notebook-default`}
                            value={option}
                            checked={checked}
                            onChange={() => onChange({ ...draft, defaultAccess: option })}
                          />
                          <span
                            aria-hidden="true"
                            className={cn("h-1.5 w-1.5 rounded-full", checked ? "bg-slate-950" : "bg-slate-400")}
                          />
                          {t(`mcp.notebookDefaultAccess.${option}.label`)}
                        </label>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-72 leading-4 text-xs">
                        {t(`mcp.notebookDefaultAccess.${option}.description`)}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
            <p className="text-xs text-slate-500">{t("mcp.notebookDefaultAccessDescription")}</p>
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">{t("mcp.notebookAccessAllDescription")}</p>
      )}
    </div>
  );
};

interface TokenListProps {
  tokens: ApiToken[];
  availableScopes: string[];
  notebooksById: ReadonlyMap<string, Notebook>;
  newlyCreatedTokenId: string | null;
  isLoading: boolean;
  isDeleting: boolean;
  onDelete: (token: ApiToken) => void;
  onEdit: (token: ApiToken) => void;
}

const TokenList = ({ tokens, availableScopes, notebooksById, newlyCreatedTokenId, isLoading, isDeleting, onDelete, onEdit }: TokenListProps) => {
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
    <div className="overflow-hidden rounded-lg border border-slate-200 divide-y divide-slate-100 bg-card">
      {tokens.map((token) => {
        const accessLevel = getStoredTokenAccessLevel(token.scopes, availableScopes, token.notebookAccess);
        const accessLabel = accessLevel === "legacy-custom"
          ? t("mcp.accessLevels.legacy-custom.label")
          : t(`mcp.accessLevels.${accessLevel}.label`);
        const grantSummary = describeNotebookAccess(token.notebookAccess, notebooksById);

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
                <span className="truncate text-xs font-normal text-slate-900">{token.name}</span>
                {accessLevel === "legacy-custom" ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="cursor-help rounded-md border border-slate-200/80 bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/15"
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
                        ? "border border-slate-200 bg-slate-100 text-slate-700"
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
                {grantSummary.length > 0 ? (
                  <span className="text-slate-500">· {t("mcp.notebookAccessSummary", { notebooks: grantSummary.join("、") })}</span>
                ) : null}
                {token.notebookDefaultAccess && token.notebookDefaultAccess !== "none" ? (
                  <span className="text-slate-500">· {t("mcp.notebookDefaultAccessSummary", { access: t(`mcp.notebookDefaultAccess.${token.notebookDefaultAccess}.label`) })}</span>
                ) : null}
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
                      className="h-8 gap-1.5 border-slate-200 bg-card px-2.5 text-xs font-normal text-slate-700 hover:bg-slate-50 hover:text-slate-900"
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
                      className="h-8 gap-1.5 border-slate-200 bg-card px-2.5 text-xs font-normal text-slate-700 hover:bg-slate-50 hover:text-slate-900"
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
                      className="h-8 w-8 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label={t("mcp.editToken")}
                      disabled={token.isRevoked}
                      onClick={() => onEdit(token)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("mcp.editToken")}</TooltipContent>
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

interface TokenEditDialogProps {
  token: ApiToken;
  availableScopes: string[];
  notebooks: Notebook[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (tokenId: string, payload: { name: string; scopes: string[]; notebookAccess?: TokenNotebookAccess[]; notebookDefaultAccess?: TokenNotebookDefaultAccess }) => void;
}

const TokenEditDialog = ({ token, availableScopes, notebooks, isSaving, onCancel, onSave }: TokenEditDialogProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState(token.name);
  const [accessLevel, setAccessLevel] = useState<TokenAccessLevel>(() => {
    const stored = getStoredTokenAccessLevel(token.scopes, availableScopes, token.notebookAccess);
    return stored === "legacy-custom" ? "custom" : stored;
  });
  const [draft, setDraft] = useState<NotebookGrantDraft>(() => notebookAccessToDraft(token.notebookAccess, token.notebookDefaultAccess));
  const notebookAccess = accessLevel === "custom" ? draftToNotebookAccess(draft) : undefined;
  const notebookValid = accessLevel !== "custom" || (notebookAccess !== undefined && notebookAccess.length > 0);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !notebookValid) return;
    onSave(token.id, {
      name: name.trim(),
      scopes: getTokenScopesForAccessLevel(accessLevel, availableScopes),
      notebookAccess,
      notebookDefaultAccess: accessLevel === "custom" ? draft.defaultAccess : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-lg gap-3 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>{t("mcp.editTokenTitle", { name: token.name })}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Input
            className="h-9 bg-card text-xs"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("mcp.namePlaceholder")}
            aria-label={t("mcp.namePlaceholder")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">{t("mcp.accessLevelTitle")}</span>
            <AccessLevelPicker value={accessLevel} onChange={setAccessLevel} name="token-edit-access-level" />
          </div>
          <p className="text-xs text-slate-500">{t(`mcp.accessLevels.${accessLevel}.description`)}</p>
          {accessLevel === "custom" ? (
            <NotebookGrantEditor notebooks={notebooks} draft={draft} onChange={setDraft} idPrefix="token-edit" />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="solid"
              type="submit"
              disabled={isSaving || !name.trim() || !notebookValid}
            >
              {t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const McpConfigCard = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => createDefaultTokenName());
  const [accessLevel, setAccessLevel] = useState<TokenAccessLevel>(DEFAULT_TOKEN_ACCESS_LEVEL);
  const [grantDraft, setGrantDraft] = useState<NotebookGrantDraft>(() => emptyNotebookGrantDraft());
  const [newlyCreatedTokenId, setNewlyCreatedTokenId] = useState<string | null>(null);
  const [tokenDeleteConfirmation, setTokenDeleteConfirmation] = useState<ApiToken | null>(null);
  const [tokenToEdit, setTokenToEdit] = useState<ApiToken | null>(null);

  const tokensQuery = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api.listApiTokens(),
  });

  const notebooksQuery = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => api.listNotebooks(),
  });

  const notebooks = notebooksQuery.data?.notebooks ?? [];
  const notebooksById = useMemo(() => new Map(notebooks.map((notebook) => [notebook.id, notebook])), [notebooks]);

  const availableScopes = tokensQuery.data?.availableScopes ?? ALL_TOKEN_SCOPES;
  const tokens = tokensQuery.data?.apiTokens ?? [];

  const createMutation = useMutation({
    mutationFn: api.createApiToken,
    onSuccess: async (data) => {
      setNewlyCreatedTokenId(data.apiToken.id);
      setName(createDefaultTokenName());
      setAccessLevel(DEFAULT_TOKEN_ACCESS_LEVEL);
      setGrantDraft(emptyNotebookGrantDraft());
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { tokenId: string; payload: { name: string; scopes: string[]; notebookAccess?: TokenNotebookAccess[]; notebookDefaultAccess?: TokenNotebookDefaultAccess } }) =>
      api.updateApiToken(input.tokenId, input.payload),
    onSuccess: async () => {
      setTokenToEdit(null);
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const deleteTokenMutation = useMutation({
    mutationFn: api.revokeApiToken,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const createNotebookAccess = accessLevel === "custom" ? draftToNotebookAccess(grantDraft) : undefined;
  const createNotebookValid = accessLevel !== "custom" || (createNotebookAccess !== undefined && createNotebookAccess.length > 0);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scopes = getTokenScopesForAccessLevel(accessLevel, availableScopes);

    if (!name.trim() || !createNotebookValid) {
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      scopes,
      notebookAccess: createNotebookAccess,
      notebookDefaultAccess: accessLevel === "custom" ? grantDraft.defaultAccess : undefined,
    });
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
                className="h-9 min-w-0 flex-1 bg-card text-xs"
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
                  className="h-9 shrink-0 gap-1 px-3.5 text-xs font-normal"
                  type="submit"
                  disabled={createMutation.isPending || !name.trim() || !createNotebookValid}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("mcp.createToken")}
                </Button>
              </div>
            </form>
            {accessLevel === "custom" ? (
              <div className="mt-3 border-t border-slate-200/70 pt-3">
                <NotebookGrantEditor notebooks={notebooks} draft={grantDraft} onChange={setGrantDraft} idPrefix="token-create" />
              </div>
            ) : null}
          </div>

          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-normal text-slate-500">
                  {t("mcp.activeTokens")}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">
                  {tokens.length}
                </span>
              </div>
            </div>
            <TokenList
              tokens={tokens}
              availableScopes={availableScopes}
              notebooksById={notebooksById}
              newlyCreatedTokenId={newlyCreatedTokenId}
              isLoading={tokensQuery.isLoading}
              isDeleting={deleteTokenMutation.isPending}
              onDelete={setTokenDeleteConfirmation}
              onEdit={setTokenToEdit}
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

      {tokenToEdit && (
        <TokenEditDialog
          token={tokenToEdit}
          availableScopes={availableScopes}
          notebooks={notebooks}
          isSaving={updateMutation.isPending}
          onCancel={() => setTokenToEdit(null)}
          onSave={(tokenId, payload) => updateMutation.mutate({ tokenId, payload })}
        />
      )}
    </>
  );
};
