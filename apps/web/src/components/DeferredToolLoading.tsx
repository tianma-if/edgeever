import { useTranslation } from "react-i18next";

export const DeferredToolLoading = () => {
  const { t } = useTranslation();
  return <div role="status" className="fixed right-4 top-4 z-[100] rounded-lg border bg-card px-4 py-2 text-sm text-slate-500 shadow-sm">{t("common.loading")}</div>;
};
