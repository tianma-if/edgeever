import { useTranslation } from "react-i18next";

const byteSize = (bytes: number, language: string) => {
  const units = ["B", "KB", "MB", "GB"];
  const index = bytes > 0 ? Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))) : 0;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: index > 0 ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
};

export const DesktopUpdateProgress = ({ progress }: { progress?: DesktopUpdateDownloadProgress | null }) => {
  const { t, i18n } = useTranslation();
  const verifying = progress?.percent === 100;
  const label = t(verifying ? "systemInfo.desktopUpdateVerifying" : "systemInfo.desktopUpdateDownloading");
  const percent = progress?.percent == null ? null : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(progress.percent);
  return (
    <div className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs text-slate-700">
        <span>{label}</span>
        {percent !== null ? <span className="tabular-nums">{percent}%</span> : null}
      </div>
      <progress
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full accent-[#16A06E] [&::-moz-progress-bar]:bg-[#16A06E] [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:bg-[#16A06E]"
        max={100}
        value={progress?.percent ?? undefined}
      />
      {!verifying && progress ? (
        <div className="flex flex-wrap justify-between gap-1 text-xs tabular-nums text-slate-500">
          {progress.transferred !== null ? <span>{byteSize(progress.transferred, i18n.language)}{progress.total !== null ? ` / ${byteSize(progress.total, i18n.language)}` : ""}</span> : null}
          {progress.bytesPerSecond !== null ? <span>{byteSize(progress.bytesPerSecond, i18n.language)}/s</span> : null}
        </div>
      ) : null}
    </div>
  );
};
