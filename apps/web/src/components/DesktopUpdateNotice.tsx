import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export const DesktopUpdateNotice = () => {
  const { t } = useTranslation();
  const bridge = window.edgeeverDesktop;

  const statusQuery = useQuery({
    queryKey: ["desktop-update-status"],
    queryFn: () => bridge!.updateStatus(),
    enabled: bridge?.isAvailable === true,
    refetchInterval: (query) => query.state.data?.state === "downloaded" ? false : 5_000,
    retry: 1,
  });
  const installMutation = useMutation({
    mutationFn: () => bridge!.installUpdate(),
  });

  useEffect(() => {
    if (!bridge?.onUpdateStatus) return;
    return bridge.onUpdateStatus((status) => {
      void statusQuery.refetch();
      if (status.state === "downloaded") window.focus();
    });
  }, [bridge, statusQuery.refetch]);

  const downloaded = bridge?.isAvailable === true && statusQuery.data?.state === "downloaded";
  if (!downloaded) return null;

  const label = installMutation.isError
    ? t("systemInfo.desktopUpdateFailed")
    : t("systemInfo.desktopUpdateRestart");

  return (
    <Button
      className="h-8 shrink-0 animate-in rounded-full bg-emerald-600 px-4 text-xs font-semibold text-white shadow-sm fade-in slide-in-from-left-2 hover:bg-emerald-700 hover:text-white"
      size="sm"
      variant="solid"
      role="alert"
      aria-live="assertive"
      aria-label={statusQuery.data?.version ? `${label} v${statusQuery.data.version}` : label}
      disabled={installMutation.isPending}
      onClick={() => installMutation.mutate()}
    >
      {installMutation.isPending
        ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        : null}
      {label}
      {!installMutation.isPending ? <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> : null}
    </Button>
  );
};
