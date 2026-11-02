import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Copy, Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { TotpSetupResponse } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ApiRequestError } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { downloadBlob } from "@/lib/infographic-image-export";
import { cn } from "@/lib/utils";

/** Maps a TOTP API failure to its user-facing message key. */
export const twoFactorErrorKey = (error: unknown) => {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "invalid_current_password": return "twoFactor.errorInvalidPassword";
      case "invalid_totp_code": return "twoFactor.errorInvalidCode";
      case "invalid_recovery_code": return "twoFactor.errorInvalidRecoveryCode";
      case "totp_setup_expired":
      case "recovery_codes_expired": return "twoFactor.errorSetupExpired";
      case "totp_unavailable": return "twoFactor.errorUnavailable";
      case "totp_encryption_unavailable": return "twoFactor.unavailableEncryption";
      case "login_rate_limited": return "twoFactor.errorRateLimited";
      default:
        if (error.status === 429) return "twoFactor.errorRateLimited";
    }
  }
  return "twoFactor.errorFailed";
};

/** Groups a base32 secret in fours so it can be read and typed reliably. */
export const formatTotpSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

export const StepProgress = ({ steps, current }: { steps: string[]; current: number }) => (
  <ol
    className="grid gap-2 text-xs"
    style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
  >
    {steps.map((label, index) => (
      <li
        key={label}
        aria-current={index === current ? "step" : undefined}
        className={cn(
          "flex flex-col gap-1.5",
          index === current ? "font-semibold text-slate-900" : index < current ? "text-slate-600" : "text-slate-500",
        )}
      >
        <span className={cn("h-1 rounded-sm", index <= current ? "bg-emerald-500" : "bg-slate-200")} />
        <span className="flex items-center gap-1">
          {index + 1} {label}
          {index < current ? <Check aria-hidden className="h-3 w-3" /> : null}
        </span>
      </li>
    ))}
  </ol>
);

export const TotpCodeField = ({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) => (
  <div className="grid gap-1.5">
    <label htmlFor={id} className="text-xs text-slate-700">{label}</label>
    <Input
      id={id}
      autoFocus={autoFocus}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="000000"
      className="h-10 font-mono text-lg tracking-[0.4em]"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
    />
  </div>
);

export const RecoveryCodeField = ({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs text-slate-700">{t("twoFactor.recoveryCode")}</label>
      <Input
        id={id}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={32}
        className="h-10 font-mono tracking-wider"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-slate-500">{t("twoFactor.recoveryCodeHint")}</p>
    </div>
  );
};

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        if (await copyTextToClipboard(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
      {copied ? t("twoFactor.copied") : label}
    </Button>
  );
};

/** QR code, manual key and the first code from the new authenticator. */
export const TotpBindStep = ({
  setup,
  code,
  onCodeChange,
}: {
  setup: TotpSetupResponse;
  code: string;
  onCodeChange: (value: string) => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex-none rounded-xl border border-slate-200 bg-white p-3">
          <QRCodeSVG
            value={setup.otpauthUri}
            size={144}
            marginSize={0}
            role="img"
            aria-label={t("twoFactor.scanQr")}
          />
        </div>
        <div className="flex min-w-[220px] flex-1 flex-col gap-2.5 text-sm leading-6 text-slate-700">
          <p>{t("twoFactor.scanQr")}</p>
          <p className="text-xs text-slate-600">{t("twoFactor.manualKey")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-xs tracking-wider">
              {formatTotpSecret(setup.secret)}
            </code>
            <CopyButton text={setup.secret} label={t("twoFactor.copy")} />
          </div>
          <p className="text-xs text-slate-500">
            {t("twoFactor.accountInfo", { issuer: setup.issuer, account: setup.accountName })}
          </p>
        </div>
      </div>
      <TotpCodeField id="totp-bind-code" label={t("twoFactor.code")} value={code} onChange={onCodeChange} autoFocus />
    </div>
  );
};

export const RecoveryCodesStep = ({
  codes,
  saved,
  onSavedChange,
}: {
  codes: string[];
  saved: boolean;
  onSavedChange: (value: boolean) => void;
}) => {
  const { t } = useTranslation();
  const text = `${codes.join("\n")}\n`;
  return (
    <div className="grid gap-4">
      <div role="note" className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900">
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
        <span>{t("twoFactor.codesWarning")}</span>
      </div>
      <ul
        aria-label={t("twoFactor.recoveryCode")}
        className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm tracking-wider text-slate-900"
      >
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={text} label={t("twoFactor.copyAll")} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => downloadBlob(new Blob([text], { type: "text/plain" }), "edgeever-recovery-codes.txt")}
        >
          <Download aria-hidden className="h-3.5 w-3.5" />
          {t("twoFactor.download")}
        </Button>
      </div>
      <label className="flex items-start gap-2.5 text-sm leading-6 text-slate-900">
        <Checkbox className="mt-1" checked={saved} onCheckedChange={(value) => onSavedChange(value === true)} />
        <span>{t("twoFactor.savedConfirm")}</span>
      </label>
    </div>
  );
};
