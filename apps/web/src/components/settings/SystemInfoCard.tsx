import { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle, CheckCircle2, ChevronDown, Copy, ExternalLink, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { fetchLatestRelease, isVersionOutdated, type LatestRelease } from "@/lib/version-check";
import { copyTextToClipboard } from "./settings-utils";

export type SystemInfoItem = {
  label: string;
  value: string;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

const detectBrowser = (userAgent: string) => {
  if (/Edg\//.test(userAgent) || /EdgA\//.test(userAgent) || /EdgiOS\//.test(userAgent)) {
    return "Microsoft Edge";
  }
  if ((/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) && !/Chromium\//.test(userAgent)) {
    return "Chrome";
  }
  if (/Firefox\//.test(userAgent)) {
    return "Firefox";
  }
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) {
    return "Safari";
  }
  return null;
};

const detectOperatingSystem = (userAgent: string, platform: string) => {
  const source = `${userAgent} ${platform}`;

  if (/Windows/i.test(source)) {
    return "Windows";
  }
  if (/Android/i.test(source)) {
    return "Android";
  }
  if (/(iPhone|iPad|iPod)/i.test(source)) {
    return "iOS";
  }
  if (/Mac/i.test(source)) {
    return "macOS";
  }
  if (/Linux/i.test(source)) {
    return "Linux";
  }
  return null;
};

const getDeploymentDescription = (t: (key: string) => string) => {
  const trigger = t(`systemInfo.deploymentTriggers.${__EDGEEVER_DEPLOYMENT_TRIGGER__}`);
  const method = t(`systemInfo.deploymentMethods.${__EDGEEVER_DEPLOYMENT_METHOD__}`);
  return `${trigger} · ${method}`;
};

export const getWebSystemInfoItems = (
  t: (key: string) => string,
  language: string
): SystemInfoItem[] => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || t("systemInfo.unknown");
  const userAgent = navigator.userAgent;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as NavigatorWithStandalone).standalone === true;

  return [
    { label: t("systemInfo.version"), value: `v${__EDGEEVER_APP_VERSION__}` },
    {
      label: t("systemInfo.releaseTime"),
      value: __EDGEEVER_RELEASED_AT__
        ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(__EDGEEVER_RELEASED_AT__))
        : t("systemInfo.unknown"),
    },
    { label: t("systemInfo.build"), value: __EDGEEVER_BUILD_LABEL__ },
    { label: t("systemInfo.deployment"), value: getDeploymentDescription(t) },
    {
      label: t("systemInfo.browser"),
      value: detectBrowser(userAgent) ?? t("systemInfo.unknown"),
    },
    {
      label: t("systemInfo.os"),
      value: detectOperatingSystem(userAgent, navigator.platform) ?? t("systemInfo.unknown"),
    },
    { label: t("systemInfo.language"), value: navigator.language || language },
    { label: t("systemInfo.timeZone"), value: timeZone },
    {
      label: t("systemInfo.installMode"),
      value: standalone ? t("systemInfo.standalone") : t("systemInfo.browserMode"),
    },
  ];
};

export const SystemInfoCard = () => {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null);
  const [releaseCheck, setReleaseCheck] = useState<"idle" | "checking" | "latest" | "outdated" | "error">("idle");

  const infoItems = useMemo<SystemInfoItem[]>(
    () => getWebSystemInfoItems(t, i18n.language),
    [i18n.language, t]
  );

  useEffect(() => {
    if (!expanded || releaseCheck !== "idle") return;

    const controller = new AbortController();
    setReleaseCheck("checking");
    void fetchLatestRelease(controller.signal)
      .then((release) => {
        setLatestRelease(release);
        setReleaseCheck(isVersionOutdated(__EDGEEVER_APP_VERSION__, release.tagName) ? "outdated" : "latest");
      })
      .catch(() => {
        if (!controller.signal.aborted) setReleaseCheck("error");
      });

    return () => controller.abort();
  }, [expanded]);

  const handleCopy = async () => {
    const details = infoItems.map((item) => `${item.label}: ${item.value}`).join("\n");

    if (!(await copyTextToClipboard(details))) {
      return;
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className="p-4">
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-emerald-700" />
                  {t("systemInfo.title")}
                </CardTitle>
                <CardDescription className="mt-1 text-xs leading-4">{t("systemInfo.description")}</CardDescription>
              </span>
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform",
                  expanded ? "rotate-180" : "rotate-0"
                )}
              />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="grid gap-3 p-4 pt-0">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full bg-white px-3 text-xs sm:w-auto"
                type="button"
                onClick={() => void handleCopy()}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? t("common.copied") : t("systemInfo.copy")}
              </Button>
            </div>
            {releaseCheck === "outdated" && latestRelease ? (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 border-l-2 border-l-emerald-500 bg-emerald-50/40 px-3 py-2 text-slate-800" role="status">
                <ArrowUpCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1 text-xs leading-5">
                  <div className="font-semibold">{t("systemInfo.updateAvailableTitle")}</div>
                  <div className="text-slate-500">{t("systemInfo.updateAvailableDescription", { version: latestRelease.tagName })}</div>
                </div>
                <a
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                  href={latestRelease.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("systemInfo.viewRelease")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : releaseCheck === "latest" ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700" role="status">
                <CheckCircle2 className="h-4 w-4" />
                {t("systemInfo.latestVersion")}
              </div>
            ) : null}
            <dl className="grid border-y border-slate-200 sm:grid-cols-3">
              {infoItems.map((item) => (
                <div key={item.label} className="min-w-0 border-b border-slate-200 px-2 py-2.5 sm:px-3">
                  <dt className="truncate text-[11px] font-semibold uppercase text-slate-400">{item.label}</dt>
                  <dd className="mt-0.5 break-words font-mono text-xs font-semibold leading-5 text-slate-800" title={item.value}>
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
