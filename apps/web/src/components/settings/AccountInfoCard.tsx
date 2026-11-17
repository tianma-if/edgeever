import { UserRound } from "lucide-react";
import type { AuthUser } from "@edgeever/shared";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import {
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";

export const AccountInfoCard = ({ user, isLoggingOut, onLogout }: {
  user: AuthUser | null;
  isLoggingOut: boolean;
  onLogout: () => void;
}) => {
  const { t } = useTranslation();
  const desktopClient = typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable === true;
  const instanceUrl = desktopClient
    ? getConfiguredDesktopApiBaseUrl()
    : typeof window !== "undefined" ? window.location.origin : "";

  if (!user) return null;

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
        <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
          <UserRound className={SETTINGS_CARD_ICON_CLASSNAME} />
          {t("accountInfo.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 pt-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-slate-900">
                  {user.displayName || user.username}
                </p>
                <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {t(`users.roles.${user.role}`)}
                </span>
              </div>
              <p className="truncate text-xs text-slate-500">
                @{user.username}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={isLoggingOut}
            onClick={onLogout}
          >
            {isLoggingOut ? t("session.loggingOut") : t("session.logout")}
          </Button>
        </div>
        {instanceUrl && (
          <div className="space-y-1 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span>{t("session.currentInstance")}</span>
              <span className="break-all font-mono text-slate-700">{instanceUrl}</span>
            </div>
            <p>
              {desktopClient
                ? t("session.signOutDescription")
                : t("session.webSignOutDescription")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
