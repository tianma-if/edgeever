import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SHARE_EXPIRY_PRESET_DAYS,
  shareExpiryFromDateInput,
  shareExpiryFromPreset,
  toDateInputValue,
} from "@/lib/share-expiry";

const presetLabelKeys: Record<(typeof SHARE_EXPIRY_PRESET_DAYS)[number], string> = {
  1: "sharing.expiry1Day",
  7: "sharing.expiry7Days",
  30: "sharing.expiry30Days",
};

export const ShareExpiryControls = ({
  expiresAt,
  expired,
  busy,
  invalid,
  onChange,
}: {
  expiresAt: string | null;
  /** Decided by the server; the dialog never compares the expiry itself. */
  expired: boolean;
  busy: boolean;
  invalid: boolean;
  onChange: (expiresAt: string | null) => void;
}) => {
  const { t, i18n } = useTranslation();
  const dateInputId = useId();
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  useEffect(() => {
    setCustomOpen(false);
    setCustomDate("");
  }, [expiresAt]);

  const locale = i18n.resolvedLanguage || i18n.language;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const formatDay = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
  const tomorrow = toDateInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const customExpiresAt = shareExpiryFromDateInput(customDate);
  const selected = customOpen ? "custom" : expiresAt ? "current" : "never";

  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium leading-5 text-slate-800">{t("sharing.expiryLabel")}</span>
        <Select
          value={selected}
          disabled={busy}
          onValueChange={(value) => {
            if (value === "custom") {
              setCustomOpen(true);
              return;
            }
            setCustomOpen(false);
            if (value === "never") onChange(null);
            else if (value !== "current") onChange(shareExpiryFromPreset(Number(value)));
          }}
        >
          <SelectTrigger className="h-8 w-44 text-xs" aria-label={t("sharing.expiryLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {expiresAt ? (
              <SelectItem value="current" className="hidden">{formatDay(expiresAt)}</SelectItem>
            ) : null}
            <SelectItem value="never">{t("sharing.expiryNever")}</SelectItem>
            {SHARE_EXPIRY_PRESET_DAYS.map((days) => (
              <SelectItem key={days} value={String(days)}>{t(presetLabelKeys[days])}</SelectItem>
            ))}
            <SelectItem value="custom">{t("sharing.expiryCustom")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {customOpen ? (
        <form
          className="flex items-center justify-end gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (customExpiresAt && !busy) onChange(customExpiresAt);
          }}
        >
          <label htmlFor={dateInputId} className="sr-only">{t("sharing.expiryCustomLabel")}</label>
          <Input
            id={dateInputId}
            type="date"
            min={tomorrow}
            value={customDate}
            onChange={(event) => setCustomDate(event.target.value)}
            className="h-8 w-44 text-xs"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="submit"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={busy || !customExpiresAt}
                aria-label={t("sharing.expiryCustomSave")}
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("sharing.expiryCustomSave")}</TooltipContent>
          </Tooltip>
        </form>
      ) : null}
      {expiresAt ? (
        <p className={`text-xs leading-5 ${expired ? "text-rose-600" : "text-slate-500"}`} role="status">
          {t(expired ? "sharing.expiredOn" : "sharing.expiresOn", { date: formatDate(expiresAt) })}
          {expired ? ` · ${t("sharing.expiredNotice")}` : null}
        </p>
      ) : null}
      {invalid ? (
        <p className="text-xs leading-5 text-rose-600" role="alert">{t("sharing.expiryInvalid")}</p>
      ) : null}
    </div>
  );
};
