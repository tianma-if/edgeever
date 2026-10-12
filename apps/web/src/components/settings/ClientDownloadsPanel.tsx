import type { ReactNode } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DESKTOP_DOWNLOAD_URL = "https://github.com/tianma-if/edgeever/releases/latest";
const ANDROID_PLAY_URL = "https://play.google.com/store/apps/details?id=org.edgeever.mobile";
const ANDROID_APK_URL = "https://github.com/tianma-if/edgeever/releases/latest";
const IOS_DOWNLOAD_URL = "https://apps.apple.com/us/app/edgeever/id6792625631";
const CHROMIUM_CLIPPER_URL = "https://chromewebstore.google.com/detail/edgeever-web-clipper/gjadpfmanienmlofajibkfkkpfdkclgo";
const FIREFOX_CLIPPER_URL = "https://addons.mozilla.org/firefox/addon/edgeever-web-clipper/";

const BrandIcon = ({ path, color, className }: { path: string; color?: string; className?: string }) => (
  <svg
    className={cn("h-6 w-6 shrink-0", className)}
    viewBox="0 0 24 24"
    aria-hidden="true"
    style={color ? { color } : undefined}
  >
    <path fill="currentColor" d={path} />
  </svg>
);

const AppStoreIcon = () => (
  <svg className="h-6 w-6 shrink-0 rounded-[2px] bg-[#0D96F6] p-[1.5px] text-white" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="m8.809 14.92l6.11-11.037c.084-.152.168-.302.244-.459c.069-.142.127-.285.165-.44c.08-.326.058-.666-.066-.977a1.5 1.5 0 0 0-.62-.735a1.42 1.42 0 0 0-.922-.193c-.32.043-.613.194-.844.43c-.11.11-.2.235-.283.368c-.092.146-.175.298-.259.45l-.386.697l-.387-.698c-.084-.151-.167-.303-.259-.449a2.2 2.2 0 0 0-.283-.369a1.45 1.45 0 0 0-.844-.429a1.42 1.42 0 0 0-.921.193a1.5 1.5 0 0 0-.62.735a1.6 1.6 0 0 0-.066.977c.038.155.096.298.164.44c.076.157.16.307.244.459l1.248 2.254l-4.862 8.782H2.03c-.168 0-.336 0-.503.01c-.152.009-.3.028-.448.071c-.31.09-.582.28-.778.548A1.58 1.58 0 0 0 .3 17.404c.197.268.468.457.779.548c.148.043.296.062.448.071c.167.01.335.01.503.01h13.097a2 2 0 0 0 .1-.27c.415-1.416-.616-2.844-2.035-2.844zm-5.696 3.622l-.792 1.5c-.082.156-.165.31-.239.471a2.4 2.4 0 0 0-.16.452a1.7 1.7 0 0 0 .064 1.003c.121.318.334.583.607.755s.589.242.901.197c.314-.044.6-.198.826-.44c.108-.115.196-.242.278-.378c.09-.15.171-.306.253-.462L6 19.464c-.09-.15-.947-1.47-2.887-.922m20.586-3.006a1.47 1.47 0 0 0-.779-.54a2 2 0 0 0-.448-.071c-.168-.01-.335-.01-.503-.01h-3.321L14.258 7.1a4.06 4.06 0 0 0-1.076 2.198a4.64 4.64 0 0 0 .546 3l5.274 9.393c.084.15.167.3.259.444c.084.13.174.253.283.364c.231.232.524.38.845.423s.643-.024.922-.19a1.5 1.5 0 0 0 .621-.726c.125-.307.146-.642.066-.964a2.2 2.2 0 0 0-.165-.434c-.075-.155-.16-.303-.244-.453l-1.216-2.166h1.596c.168 0 .335 0 .503-.009c.152-.009.3-.028.448-.07a1.47 1.47 0 0 0 .78-.541a1.54 1.54 0 0 0 .3-.916a1.54 1.54 0 0 0-.3-.916" />
  </svg>
);

const GooglePlayIcon = () => (
  <svg className="h-6 w-6 shrink-0" viewBox="0 0 28.99 31.99" aria-hidden="true">
    <path fill="#EA4335" d="M13.54 15.28.12 29.34a3.66 3.66 0 0 0 5.33 2.16l15.1-8.6Z" />
    <path fill="#FBBC04" d="m27.11 12.89l-6.53-3.74l-7.35 6.45l7.38 7.28l6.48-3.7a3.54 3.54 0 0 0 1.5-4.79a3.62 3.62 0 0 0-1.5-1.5" />
    <path fill="#4285F4" d="M.12 2.66a3.57 3.57 0 0 0-.12.92v24.84a3.57 3.57 0 0 0 .12.92L14 15.64Z" />
    <path fill="#34A853" d="m13.64 16l6.94-6.85L5.5.51A3.73 3.73 0 0 0 3.63 0A3.64 3.64 0 0 0 .12 2.65Z" />
  </svg>
);

const ChromeIcon = () => (
  <svg className="h-6 w-6 shrink-0" viewBox="0 0 256 256" aria-hidden="true">
    <circle cx="128" cy="128" r="64" fill="#FFFFFF" />
    <path fill="#34A853" d="M96 183.4A63.7 63.7 0 0 1 72.6 160L17.2 64A128 128 0 0 0 128 256l55.4-96A64 64 0 0 1 96 183.4Z" />
    <path fill="#FBBC04" d="M192 128a63.7 63.7 0 0 1-8.6 32L128 256A128 128 0 0 0 238.9 64h-111a64 64 0 0 1 64 64Z" />
    <circle cx="128" cy="128" r="52" fill="#1A73E8" />
    <path fill="#EA4335" d="M96 72.6a63.7 63.7 0 0 1 32-8.6h110.8a128 128 0 0 0-221.7 0l55.5 96A64 64 0 0 1 96 72.6Z" />
  </svg>
);

const APPLE_ICON_PATH = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04c-2.04.027-3.91 1.183-4.961 3.014c-2.117 3.675-.546 9.103 1.519 12.09c1.013 1.454 2.208 3.09 3.792 3.039c1.52-.065 2.09-.987 3.935-.987c1.831 0 2.35.987 3.96.948c1.637-.026 2.676-1.48 3.676-2.948c1.156-1.688 1.636-3.325 1.662-3.415c-.039-.013-3.182-1.221-3.22-4.857c-.026-3.04 2.48-4.494 2.597-4.559c-1.429-2.09-3.623-2.324-4.39-2.376c-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83c-1.207.052-2.662.805-3.532 1.818c-.78.896-1.454 2.338-1.273 3.714c1.338.104 2.715-.688 3.559-1.701";
const LINUX_ICON_PATH =
  "M12.504 0q-.232 0-.48.021c-4.226.333-3.105 4.807-3.17 6.298c-.076 1.092-.3 1.953-1.05 3.02c-.885 1.051-2.127 2.75-2.716 4.521c-.278.832-.41 1.684-.287 2.489a.4.4 0 0 0-.11.135c-.26.268-.45.6-.663.839c-.199.199-.485.267-.797.4c-.313.136-.658.269-.864.68c-.09.189-.136.394-.132.602c0 .199.027.4.055.536c.058.399.116.728.04.97c-.249.68-.28 1.145-.106 1.484c.174.334.535.47.94.601c.81.2 1.91.135 2.774.6c.926.466 1.866.67 2.616.47c.526-.116.97-.464 1.208-.946c.587-.003 1.23-.269 2.26-.334c.699-.058 1.574.267 2.577.2c.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071s1.592-.536 2.257-1.306c.631-.765 1.683-1.084 2.378-1.503c.348-.199.629-.469.649-.853c.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926c-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.36.36 0 0 0-.19-.064c.431-1.278.264-2.55-.173-3.694c-.533-1.41-1.465-2.638-2.175-3.483c-.796-1.005-1.576-1.957-1.56-3.368c.026-2.152.236-6.133-3.544-6.139m.529 3.405h.013c.213 0 .396.062.584.198c.19.135.33.332.438.533c.105.259.158.459.166.724c0-.02.006-.04.006-.06v.105l-.004-.021l-.004-.024a1.8 1.8 0 0 1-.15.706a.95.95 0 0 1-.213.335a1 1 0 0 0-.088-.042c-.104-.045-.198-.064-.284-.133a1.3 1.3 0 0 0-.22-.066c.05-.06.146-.133.183-.198q.08-.193.088-.402v-.02a1.2 1.2 0 0 0-.061-.4c-.045-.134-.101-.2-.183-.333c-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 0 0-.205.334a1.2 1.2 0 0 0-.09.4v.019q.002.134.02.267c-.193-.067-.438-.135-.607-.202a2 2 0 0 1-.018-.2v-.02a1.8 1.8 0 0 1 .15-.768a1.08 1.08 0 0 1 .43-.533a1 1 0 0 1 .594-.2zm-2.962.059h.036c.142 0 .27.048.399.135c.146.129.264.288.344.465c.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024c-.152.055-.274.135-.393.2q.018-.136.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.6.6 0 0 0-.166-.267a.25.25 0 0 0-.183-.064h-.021c-.071.006-.13.04-.186.132a.55.55 0 0 0-.12.27a1 1 0 0 0-.023.33v.015c.012.135.037.2.08.334c.046.134.098.2.166.268q.014.014.034.024c-.07.057-.117.07-.176.136a.3.3 0 0 1-.131.068a2.6 2.6 0 0 1-.275-.402a1.8 1.8 0 0 1-.155-.667a1.8 1.8 0 0 1 .08-.668a1.4 1.4 0 0 1 .283-.535c.128-.133.26-.2.418-.2m1.37 1.706c.332 0 .733.065 1.216.399c.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.57.57 0 0 1 .016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465c-.276.135-.588.292-1.012.267a1.1 1.1 0 0 1-.448-.067a4 4 0 0 1-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71q-.104-.403.193-.6c.224-.135.38-.271.483-.336c.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601c.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473c.286.534.855 1.659 1.102 3.024c.156-.005.33.018.513.064c.646-1.671-.546-3.467-1.089-3.966c-.22-.2-.232-.335-.123-.335c.59.534 1.365 1.572 1.646 2.757c.13.535.16 1.104.021 1.67c.067.028.135.06.205.067c1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224c-.915-.4-1.646-.336-1.77.465c-.008.043-.013.066-.018.135c-.068.023-.139.053-.209.064c-.43.268-.662.669-.793 1.187c-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35c-1.5 1.072-3.58 1.538-5.348.334a2.7 2.7 0 0 0-.402-.533a1.5 1.5 0 0 0-.275-.333c.182 0 .338-.03.465-.067a.62.62 0 0 0 .314-.334c.108-.267 0-.697-.345-1.163s-.931-.995-1.788-1.521c-.63-.4-.986-.87-1.15-1.396c-.165-.534-.143-1.085-.015-1.645c.245-1.07.873-2.11 1.274-2.763c.107-.065.037.135-.408.974c-.396.751-1.14 2.497-.122 3.854a8.1 8.1 0 0 1 .647-2.876c.564-1.278 1.743-3.504 1.836-5.268c.048.036.217.135.289.202c.218.133.38.333.59.465c.21.201.477.335.876.335q.058.005.11.006c.412 0 .73-.134.997-.268c.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377c.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876c.085.4.154.78.409 1.066c.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595c-.63.401-1.746.712-2.457 1.57c-.618.737-1.37 1.14-2.036 1.191c-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69c.176-.668.428-1.344.463-1.897c.037-.714.076-1.335.195-1.814c.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01q.08 0 .157.014c.376.055.706.333 1.023.752l.91 1.664l.003.003c.243.533.754 1.064 1.189 1.637c.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294c-.645.135-1.52.002-2.395-.464c-.968-.536-2.118-.469-2.857-.602q-.553-.1-.723-.4c-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118c-.055-.401-.083-.71.043-.94c.16-.334.396-.4.69-.533c.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838c.19-.201.38-.336.663-.336m7.159-9.074c-.435.201-.945.535-1.488.535c-.542 0-.97-.267-1.28-.466c-.154-.134-.28-.268-.373-.335c-.164-.134-.144-.333-.074-.333c.109.016.129.134.199.2c.096.066.215.2.36.333c.292.2.68.467 1.167.467c.485 0 1.053-.267 1.398-.466c.195-.135.445-.334.648-.467c.156-.136.149-.267.279-.267c.128.016.034.134-.147.332a8 8 0 0 1-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05c.074-.043.18-.027.26.004c.063 0 .16.067.15.135c-.006.049-.085.066-.135.066c-.055 0-.092-.043-.141-.068c-.052-.018-.146-.008-.163-.065m-.551 0c-.02.058-.113.049-.166.066c-.047.025-.086.068-.14.068c-.05 0-.13-.02-.136-.068c-.01-.066.088-.133.15-.133c.08-.031.184-.047.259-.005c.019.009.036.03.03.05v.02h.003z";
const WINDOWS_ICON_PATH = "M0 0h11.377v11.372H0Zm12.623 0H24v11.372H12.623ZM0 12.623h11.377V24H0Zm12.623 0H24V24H12.623";
const FIREFOX_ICON_PATH = "M8.824 7.287c.008 0 .004 0 0 0m-2.8-1.4c.006 0 .003 0 0 0m16.754 2.161c-.505-1.215-1.53-2.528-2.333-2.943c.654 1.283 1.033 2.57 1.177 3.53l.002.02c-1.314-3.278-3.544-4.6-5.366-7.477c-.091-.147-.184-.292-.273-.446a4 4 0 0 1-.13-.24a2 2 0 0 1-.172-.46a.03.03 0 0 0-.027-.03a.04.04 0 0 0-.021 0l-.006.001l-.01.005l.005-.008c-2.585 1.515-3.657 4.168-3.932 5.856a6.2 6.2 0 0 0-2.305.587a.297.297 0 0 0-.147.37c.057.162.24.24.396.17a5.6 5.6 0 0 1 2.008-.523l.067-.005a5.9 5.9 0 0 1 1.957.222l.095.03a6 6 0 0 1 .616.228q.12.054.238.112l.107.055a6 6 0 0 1 .368.211a5.95 5.95 0 0 1 2.034 2.104c-.62-.437-1.733-.868-2.803-.681c4.183 2.09 3.06 9.292-2.737 9.02a5.2 5.2 0 0 1-1.513-.292a4 4 0 0 1-.538-.232c-1.42-.735-2.593-2.121-2.74-3.806c0 0 .537-2 3.845-2c.357 0 1.38-.998 1.398-1.287c-.005-.095-2.029-.9-2.817-1.677c-.422-.416-.622-.616-.8-.767a4 4 0 0 0-.301-.227a5.4 5.4 0 0 1-.032-2.842c-1.195.544-2.124 1.403-2.8 2.163h-.006c-.46-.584-.428-2.51-.402-2.913c-.006-.025-.343.176-.389.206a8.4 8.4 0 0 0-1.136.974q-.596.606-1.085 1.303a9.8 9.8 0 0 0-1.562 3.52c-.003.013-.11.487-.19 1.073q-.02.135-.037.272a8 8 0 0 0-.069.667l-.002.034l-.023.387l-.001.06C.386 18.795 5.593 24 12.016 24c5.752 0 10.527-4.176 11.463-9.661q.028-.223.052-.448c.232-1.994-.025-4.09-.753-5.844z";

interface DownloadCardProps {
  name: string;
  icon: ReactNode;
  format: string;
  description: string;
  children: ReactNode;
}

const DownloadCard = ({ name, icon, format, description, children }: DownloadCardProps) => (
  <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-card p-4 transition-colors hover:border-emerald-500/40">
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-slate-900">{name}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{format}</p>
      </div>
    </div>
    <p className="flex-1 text-xs leading-relaxed text-slate-500">{description}</p>
    <div className="flex flex-wrap gap-2">{children}</div>
  </article>
);

const DownloadLink = ({ href, label, name, secondary = false }: { href: string; label: string; name: string; secondary?: boolean }) => (
  <Button asChild variant={secondary ? "outline" : "solid"} size="sm" className="h-auto min-h-9 max-w-full gap-2 whitespace-normal text-left text-xs">
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${name}: ${label}`}>
      <span>{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  </Button>
);

export const ClientDownloadsPanel = () => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      <header className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
        <div className="mb-2 flex items-center gap-2 text-emerald-600">
          <Download className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-900">{t("pwa.sidebarDownloads")}</h2>
        </div>
        <p className="text-sm leading-relaxed text-slate-600">{t("pwa.downloadsDescription")}</p>
      </header>
      <section aria-labelledby="downloads-desktop" className="grid gap-3">
        <h2 id="downloads-desktop" className="text-sm font-medium text-slate-900">{t("pwa.downloadsDesktop")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <DownloadCard name={t("pwa.sidebarMac")} icon={<BrandIcon path={APPLE_ICON_PATH} />} format="DMG · Apple Silicon / Intel" description={t("pwa.downloadsMacDescription")}>
            <DownloadLink href={DESKTOP_DOWNLOAD_URL} name={t("pwa.sidebarMac")} label={t("pwa.downloadsReleaseAction")} />
          </DownloadCard>
          <DownloadCard name={t("pwa.sidebarWindows")} icon={<BrandIcon path={WINDOWS_ICON_PATH} color="#0078D4" />} format="EXE · x64" description={t("pwa.sidebarWindowsAvailability")}>
            <DownloadLink href={DESKTOP_DOWNLOAD_URL} name={t("pwa.sidebarWindows")} label={t("pwa.downloadsReleaseAction")} />
          </DownloadCard>
          <DownloadCard name={t("pwa.sidebarLinux")} icon={<BrandIcon path={LINUX_ICON_PATH} />} format="AppImage · x86_64" description={t("pwa.sidebarLinuxAvailability")}>
            <DownloadLink href={DESKTOP_DOWNLOAD_URL} name={t("pwa.sidebarLinux")} label={t("pwa.downloadsReleaseAction")} />
          </DownloadCard>
        </div>
      </section>
      <section aria-labelledby="downloads-mobile" className="grid gap-3">
        <h2 id="downloads-mobile" className="text-sm font-medium text-slate-900">{t("pwa.downloadsMobile")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <DownloadCard name={t("pwa.sidebarAndroid")} icon={<GooglePlayIcon />} format={t("pwa.sidebarAndroidGooglePlay")} description={t("pwa.downloadsAndroidDescription")}>
            <DownloadLink href={ANDROID_PLAY_URL} name={t("pwa.sidebarAndroid")} label={t("pwa.sidebarAndroidGooglePlay")} />
            <DownloadLink href={ANDROID_APK_URL} name={t("pwa.sidebarAndroid")} label={t("pwa.sidebarAndroidApk")} secondary />
          </DownloadCard>
          <DownloadCard name={t("pwa.sidebarIos")} icon={<AppStoreIcon />} format={t("pwa.sidebarIosBadge")} description={t("pwa.sidebarIosAvailability")}>
            <DownloadLink href={IOS_DOWNLOAD_URL} name={t("pwa.sidebarIos")} label={t("pwa.sidebarIosBadge")} />
          </DownloadCard>
        </div>
      </section>
      <section aria-labelledby="downloads-clippers" className="grid gap-3">
        <h2 id="downloads-clippers" className="text-sm font-medium text-slate-900">{t("pwa.sidebarGroupClippers")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <DownloadCard name={t("pwa.sidebarChromeEdge")} icon={<ChromeIcon />} format={t("pwa.sidebarWebStoreBadge")} description={t("pwa.downloadsClipperDescription")}>
            <DownloadLink href={CHROMIUM_CLIPPER_URL} name={t("pwa.sidebarChromeEdge")} label={t("pwa.sidebarWebStoreBadge")} />
          </DownloadCard>
          <DownloadCard name={t("pwa.sidebarFirefox")} icon={<BrandIcon path={FIREFOX_ICON_PATH} color="#FF7139" />} format={t("pwa.sidebarAddonsBadge")} description={t("pwa.downloadsClipperDescription")}>
            <DownloadLink href={FIREFOX_CLIPPER_URL} name={t("pwa.sidebarFirefox")} label={t("pwa.sidebarAddonsBadge")} />
          </DownloadCard>
        </div>
      </section>
    </div>
  );
};
