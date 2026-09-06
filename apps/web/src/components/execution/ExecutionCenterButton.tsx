import { FileClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Temporarily hide the shared header entry without disabling schedules or the log page.
const SHOW_SCHEDULED_TASK_LOG_ENTRY = false;

interface ExecutionCenterButtonProps {
  onClick(): void;
  className?: string;
}

export const ExecutionCenterButton = ({ onClick, className }: ExecutionCenterButtonProps) => {
  const { t } = useTranslation();

  if (!SHOW_SCHEDULED_TASK_LOG_ENTRY) return null;

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("executionHistory.openCenter")}
            className={cn(
              "h-9 w-9 shrink-0 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-500/70",
              className,
            )}
            onClick={onClick}
          >
            <FileClock className="h-5 w-5" strokeWidth={2.1} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("executionHistory.openCenter")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
