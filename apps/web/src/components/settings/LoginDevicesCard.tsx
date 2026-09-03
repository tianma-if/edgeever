import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Laptop, MonitorSmartphone, Pencil, Smartphone, Tablet, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { LoginSessionRevokeDialog, type LoginSessionRevokeTarget } from "./LoginSessionRevokeDialog";

interface LoginDevicesCardProps {
  authRequired: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
}

type DeviceKind = "mobile" | "tablet" | "desktop" | "unknownDevice";

const describeUserAgent = (userAgent: string | null) => {
  if (!userAgent) return { deviceKind: "unknownDevice" as const, os: "", browser: "" };

  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent));
  const isMobile = !isTablet && /Mobile|iPhone|iPod|Android|IEMobile|Opera Mini|okhttp/i.test(userAgent);
  const deviceKind: DeviceKind = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";
  const os = /Windows NT/i.test(userAgent)
    ? "Windows"
    : /iPad|iPhone|iPod/i.test(userAgent)
      ? "iOS"
      : /Android/i.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? "macOS"
          : /CrOS/i.test(userAgent)
            ? "ChromeOS"
            : /Linux/i.test(userAgent)
              ? "Linux"
              : "";
  const browser = /EdgeEver|okhttp/i.test(userAgent)
    ? "EdgeEver"
    : /EdgA?\//i.test(userAgent)
    ? "Edge"
    : /OPR\//i.test(userAgent)
      ? "Opera"
      : /CriOS|Chrome\//i.test(userAgent)
        ? "Chrome"
        : /FxiOS|Firefox\//i.test(userAgent)
          ? "Firefox"
          : /Safari\//i.test(userAgent)
            ? "Safari"
            : "";

  return { deviceKind, os, browser };
};

const getDeviceIcon = (deviceKind: DeviceKind) => {
  if (deviceKind === "mobile") return Smartphone;
  if (deviceKind === "tablet") return Tablet;
  if (deviceKind === "desktop") return Laptop;
  return MonitorSmartphone;
};

const formatSessionTime = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const LoginDevicesCard = ({ authRequired, isLoggingOut, onLogout }: LoginDevicesCardProps) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = useState<LoginSessionRevokeTarget | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const sessionsQuery = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: api.listLoginDeviceSessions,
    enabled: authRequired,
  });
  const revokeMutation = useMutation({
    mutationFn: (target: LoginSessionRevokeTarget) =>
      target.type === "others"
        ? api.revokeOtherLoginDeviceSessions()
        : api.revokeLoginDeviceSession(target.sessionId),
    onSuccess: async () => {
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
  });
  const labelMutation = useMutation({
    mutationFn: ({ sessionId, label }: { sessionId: string; label: string | null }) =>
      api.updateLoginDeviceSession(sessionId, { label }),
    onSuccess: async () => {
      setEditingSessionId(null);
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
  });

  if (!authRequired) return null;

  const handleDialogOpenChange = (open: boolean) => {
    if (!open && !revokeMutation.isPending) {
      setRevokeTarget(null);
      revokeMutation.reset();
    }
  };

  return (
    <>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <MonitorSmartphone className="h-4 w-4 text-emerald-700" />
              {t("loginDevices.title")}
            </CardTitle>
            <CardDescription className="mt-1">{t("loginDevices.description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {sessionsQuery.isLoading ? <p className="text-sm text-slate-500">{t("loginDevices.loading")}</p> : null}
          {sessionsQuery.isError ? <p className="text-sm font-medium text-rose-600" role="alert">{t("loginDevices.loadFailed")}</p> : null}
          {sessionsQuery.data?.sessions.length === 0 ? <p className="text-sm text-slate-500">{t("loginDevices.empty")}</p> : null}
          {sessionsQuery.data?.sessions.length ? (
            <ul className="divide-y divide-slate-100">
              {sessionsQuery.data.sessions.map((session) => {
                const { deviceKind, os, browser } = describeUserAgent(session.userAgent);
                const DeviceIcon = getDeviceIcon(deviceKind);
                const details = [os, browser || t("loginDevices.unknownBrowser")].filter(Boolean).join(" · ");
                const location = [session.ipAddress, session.ipCountry, session.ipRegion].filter(Boolean).join(" · ");
                const isEditing = editingSessionId === session.id;

                return (
                  <li key={session.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <DeviceIcon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isEditing ? (
                          <Input
                            autoFocus
                            maxLength={80}
                            className="h-8 w-48"
                            value={labelDraft}
                            placeholder={t("loginDevices.labelPlaceholder")}
                            onChange={(event) => setLabelDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") labelMutation.mutate({ sessionId: session.id, label: labelDraft.trim() || null });
                              if (event.key === "Escape") setEditingSessionId(null);
                            }}
                          />
                        ) : (
                          <p className="text-sm font-semibold text-slate-800">{session.label || t(`loginDevices.${deviceKind}`)}</p>
                        )}
                        {session.isCurrent ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            {t("loginDevices.current")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={session.userAgent ?? undefined}>{details}</p>
                      {location ? <p className="mt-0.5 truncate text-xs text-slate-500">{t("loginDevices.location", { location })}</p> : null}
                      <p className="mt-1 text-xs text-slate-500">
                        {t("loginDevices.lastSeen", { time: formatSessionTime(session.lastSeenAt, locale) })}
                        <span aria-hidden="true"> · </span>
                        {t("loginDevices.signedIn", { time: formatSessionTime(session.createdAt, locale) })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={t("loginDevices.saveLabel")}
                            disabled={labelMutation.isPending}
                            onClick={() => labelMutation.mutate({ sessionId: session.id, label: labelDraft.trim() || null })}
                          ><Check className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" aria-label={t("loginDevices.cancelLabel")} onClick={() => setEditingSessionId(null)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("loginDevices.editLabel")}
                          onClick={() => { setEditingSessionId(session.id); setLabelDraft(session.label ?? ""); }}
                        ><Pencil className="h-4 w-4" /></Button>
                      )}
                    {session.isCurrent ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={isLoggingOut}
                        onClick={onLogout}
                      >
                        {isLoggingOut ? t("session.loggingOut") : t("loginDevices.revokeDevice")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={revokeMutation.isPending}
                        onClick={() => setRevokeTarget({ type: "session", sessionId: session.id })}
                      >
                        {t("loginDevices.revokeDevice")}
                      </Button>
                    )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>
      <LoginSessionRevokeDialog
        target={revokeTarget}
        isPending={revokeMutation.isPending}
        isError={revokeMutation.isError}
        onOpenChange={handleDialogOpenChange}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget)}
      />
    </>
  );
};
