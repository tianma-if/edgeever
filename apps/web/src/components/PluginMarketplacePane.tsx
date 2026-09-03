import { ChevronLeft, Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import * as m from "motion/react-m";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PluginManagerCard } from "@/components/settings/PluginManagerCard";
import type { EdgeEverPluginHost } from "@/lib/plugins/plugin-host";
import { contentEnterMotion } from "@/lib/motion";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { ExecutionCenterButton } from "@/components/execution/ExecutionCenterButton";

export const PluginMarketplacePane = ({
  host,
  onClose,
  onOpenExecutionCenter,
}: {
  host: EdgeEverPluginHost;
  onClose: () => void;
  onOpenExecutionCenter: () => void;
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pluginId = null } = useParams<{ pluginId: string }>();
  const close = () => {
    if (pluginId) {
      navigate("/plugins");
      return;
    }
    onClose();
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-slate-50">
      <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:px-6 lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("common.back")}
            onClick={close}
            className="h-9 w-9 rounded-lg hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <h1 className={`flex min-w-0 items-center gap-2 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
            <Store className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="truncate text-slate-900">{t("plugins.marketplace.title")}</span>
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <ExecutionCenterButton onClick={onOpenExecutionCenter} />
          <ThemeToggle className="inline-flex" showLabel />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:py-7">
        <m.div className="mx-auto w-full max-w-5xl" {...contentEnterMotion}>
          <PluginManagerCard
            host={host}
            selectedPluginId={pluginId}
            onOpenPlugin={(id) => navigate(`/plugins/${encodeURIComponent(id)}`)}
            onClosePlugin={() => navigate("/plugins")}
          />
        </m.div>
      </main>
    </div>
  );
};
