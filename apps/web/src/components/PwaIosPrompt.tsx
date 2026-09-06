import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePwaInstall } from "./PwaInstallContext";

export const PwaIosPrompt = () => {
  const { t } = useTranslation();
  const { showIOSPrompt, dismissIOSPrompt } = usePwaInstall();

  if (!showIOSPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-6 left-4 right-4 z-50 mx-auto max-w-md animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-md">
        {/* Decorative top accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
        
        <button
          onClick={dismissIOSPrompt}
          className="absolute right-2 top-2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          aria-label={t("common.close") || "Close"}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3.5 pr-6">
          <img
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
            className="h-11 w-11 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900 leading-snug">
              {t("pwa.iosPrompt.title") || "将 EdgeEver 安装到主屏幕"}
            </h3>
            <p className="mt-1 text-xs text-slate-500 leading-normal">
              {t("pwa.iosPrompt.subtitle") || "享受全屏独立窗口，体验如原生 App 般丝滑的印象笔记。"}
            </p>
            
            <div className="mt-3.5 flex flex-col gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white border border-slate-200/60 shadow-sm text-slate-500 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </span>
                <span>
                  1. {t("pwa.iosPrompt.step1") || "点击 Safari 浏览器底部的分享按钮"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white border border-slate-200/60 shadow-sm text-slate-500 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </span>
                <span>
                  2. {t("pwa.iosPrompt.step2") || "在菜单中找到并选择「添加到主屏幕」"}
                </span>
              </div>
            </div>

            <button
              onClick={dismissIOSPrompt}
              className="mt-3.5 w-full rounded-lg bg-emerald-600 py-2 text-center text-xs font-semibold text-white shadow-sm shadow-emerald-600/10 transition-all hover:bg-emerald-700 active:scale-[0.98]"
            >
              {t("pwa.iosPrompt.dismiss") || "我知道了"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
