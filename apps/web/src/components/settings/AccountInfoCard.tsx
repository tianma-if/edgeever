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
  const instanceUrl = getConfiguredDesktopApiBaseUrl();

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
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-800">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-normal text-slate-800">
              {user.displayName || user.username}
            </p>
            <p className="truncate text-xs text-slate-500">
              @{user.username} · {t(`users.roles.${user.role}`)}
            </p>
          </div>
        </div>
        {instanceUrl && (
          <div className="space-y-1 text-xs leading-5 text-slate-500">
            <p className="break-all">{instanceUrl}</p>
            <p>{t("session.desktopSignOutDescription")}</p>
          </div>
        )}
        <div>
          <Button
            variant="outline"
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 focus-visible:ring-rose-600/30"
            disabled={isLoggingOut}
            onClick={onLogout}
          >
            {isLoggingOut ? t("session.loggingOut") : t("session.logout")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
