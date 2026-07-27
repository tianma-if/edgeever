import { UserRound } from "lucide-react";
import type { AuthUser } from "@edgeever/shared";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const AccountInfoCard = ({ user }: { user: AuthUser | null }) => {
  const { t } = useTranslation();

  if (!user) return null;

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UserRound className="h-4 w-4 text-emerald-700" />
          {t("accountInfo.title")}
        </CardTitle>
        <CardDescription>{t("accountInfo.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3 p-4 pt-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">
            {user.displayName || user.username}
          </p>
          <p className="truncate text-xs text-slate-500">
            @{user.username} · {t(`users.roles.${user.role}`)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
