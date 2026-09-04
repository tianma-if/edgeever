import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InstanceUser } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
  SETTINGS_ITEM_TITLE_CLASSNAME,
} from "./settings-ui";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiRequestError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface UserManagementCardProps {
  demoMode: boolean;
}

export const UserManagementCard = ({ demoMode }: UserManagementCardProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<InstanceUser | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });
  const createMutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: () => {
      setCreateOpen(false);
      setUsername("");
      setDisplayName("");
      setPassword("");
      void refresh();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: { password?: string; isDisabled?: boolean } }) =>
      api.updateUser(userId, input),
    onSuccess: () => void refresh(),
  });

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    createMutation.mutate({ username, displayName: displayName || null, password });
  };

  const handleCreateOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      setUsername("");
      setDisplayName("");
      setPassword("");
      createMutation.reset();
    }
  };

  const createError =
    createMutation.error instanceof ApiRequestError && createMutation.error.code === "username_exists"
      ? t("users.usernameExists")
      : t("users.failed");

  const handleReset = (event: FormEvent) => {
    event.preventDefault();
    if (!resetUser) return;
    updateMutation.mutate(
      { userId: resetUser.id, input: { password: resetPassword } },
      { onSuccess: () => { setResetUser(null); setResetPassword(""); } },
    );
  };

  return (
    <>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                <Users className={SETTINGS_CARD_ICON_CLASSNAME} />
                {t("users.title")}
              </CardTitle>
              <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>{t("users.description")}</CardDescription>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-4 w-4" /> {t("users.create")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 p-4 pt-0">
          {usersQuery.isLoading ? <p className="text-sm text-slate-500">{t("users.loading")}</p> : null}
          {usersQuery.data?.users.map((user) => (
            <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-card/40 p-3">
              <div className="min-w-0">
                <p className={cn("truncate", SETTINGS_ITEM_TITLE_CLASSNAME)}>{user.displayName || user.username}</p>
                <p className="truncate text-xs text-slate-500">@{user.username} · {t(`users.roles.${user.role}`)}</p>
              </div>
              <div className="flex items-center gap-3">
                {demoMode && user.role === "owner" ? null : (
                  <Button size="sm" variant="outline" onClick={() => setResetUser(user)}>
                    <KeyRound className="h-3.5 w-3.5" /> {t("users.resetPassword")}
                  </Button>
                )}
                {user.role !== "owner" ? (
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    {user.isDisabled ? t("users.disabled") : t("users.enabled")}
                    <Switch
                      checked={!user.isDisabled}
                      disabled={updateMutation.isPending}
                      onCheckedChange={(checked) => updateMutation.mutate({ userId: user.id, input: { isDisabled: !checked } })}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ))}
          {usersQuery.isError || createMutation.isError || updateMutation.isError ? (
            <p className="text-xs font-medium text-rose-600">{t("users.failed")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-100 px-6 py-5 pr-12">
            <DialogTitle>{t("users.createTitle")}</DialogTitle>
            <DialogDescription className="leading-6">{t("users.createDescription")}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-5 px-6 py-5" autoComplete="off" onSubmit={handleCreate}>
            <label className="grid gap-2 text-sm font-medium text-slate-700" htmlFor="edgeever-new-account-username">
              {t("users.username")}
              <Input
                id="edgeever-new-account-username"
                name="edgeever-new-account-username"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t("users.usernamePlaceholder")}
                required
                maxLength={80}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700" htmlFor="edgeever-new-account-display-name">
              {t("users.displayName")}
              <Input
                id="edgeever-new-account-display-name"
                name="edgeever-new-account-display-name"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t("users.displayNamePlaceholder")}
                maxLength={80}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-700" htmlFor="edgeever-new-account-password">
              {t("users.password")}
              <Input
                id="edgeever-new-account-password"
                name="edgeever-new-account-password"
                type="password"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("users.passwordPlaceholder")}
                minLength={8}
                required
              />
              <span className="text-xs font-normal text-slate-500">{t("users.passwordHint")}</span>
            </label>
            {createMutation.isError ? <p className="text-sm font-medium text-rose-600" role="alert">{createError}</p> : null}
            <DialogFooter className="mt-1 gap-2 sm:space-x-0">
              <DialogClose asChild><Button type="button" variant="outline">{t("common.cancel")}</Button></DialogClose>
              <Button type="submit" variant="solid" disabled={createMutation.isPending}>
                {createMutation.isPending ? t("users.creating") : t("users.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetUser)} onOpenChange={(open) => { if (!open) setResetUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("users.resetTitle", { username: resetUser?.username })}</DialogTitle><DialogDescription>{t("users.resetDescription")}</DialogDescription></DialogHeader>
          <form className="grid gap-4" autoComplete="off" onSubmit={handleReset}>
            <label className="grid gap-2 text-sm font-medium text-slate-700" htmlFor="edgeever-reset-account-password">
              {t("users.newPassword")}
              <Input id="edgeever-reset-account-password" name="edgeever-reset-account-password" type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder={t("users.passwordPlaceholder")} minLength={8} required />
            </label>
            <DialogFooter className="gap-2 sm:space-x-0">
              <DialogClose asChild><Button type="button" variant="outline">{t("common.cancel")}</Button></DialogClose>
              <Button type="submit" variant="solid" disabled={updateMutation.isPending}>{t("users.resetPassword")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
