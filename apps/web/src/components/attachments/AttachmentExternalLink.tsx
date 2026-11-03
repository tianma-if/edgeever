import { forwardRef, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { isDesktopResourceRuntime, toDesktopResourceUrl } from "@/lib/desktop-resources";

type Props = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
  filename: string;
  iconOnly?: boolean;
};

/** Browsers keep normal link behavior; desktop attachments open a local copy. */
export const AttachmentExternalLink = forwardRef<HTMLAnchorElement, Props>(
  ({ href, filename, iconOnly, children, onClick, ...props }, ref) => {
    const { t } = useTranslation();
    const busy = useRef(false);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    return (
      <>
        <a
          {...props}
          ref={ref}
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-busy={opening || undefined}
          aria-disabled={opening || undefined}
          onClick={(event) => {
            onClick?.(event);
            if (event.defaultPrevented || !isDesktopResourceRuntime()) return;
            const url = toDesktopResourceUrl(href);
            if (!url.startsWith("edgeever-resource://") && !url.startsWith("edgeever-staged://")) return;
            event.preventDefault();
            if (busy.current) return;
            busy.current = true;
            setOpening(true);
            // Invoke synchronously while the click still has user activation.
            const request = window.edgeeverDesktop?.openAttachment?.({ url, filename });
            void Promise.resolve(request).then((result) => {
              if (!result?.ok) setError(result?.code ?? "open-failed");
            }).catch(() => setError("open-failed")).finally(() => {
              busy.current = false;
              setOpening(false);
            });
          }}
        >
          {opening ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" /> : null}
          {opening && iconOnly ? null : children}
          {opening ? <span className="sr-only">{t("attachmentOpen.opening")}</span> : null}
        </a>
        <Dialog open={error !== null} onOpenChange={(open) => { if (!open) setError(null); }}>
          <DialogContent showCloseButton={false}>
            <DialogTitle>{t("attachmentOpen.failed")}</DialogTitle>
            <DialogDescription>
              {t(error === "blocked" ? "attachmentOpen.blocked"
                : error === "unavailable" ? "attachmentOpen.unavailable"
                  : error === "forbidden" ? "attachmentOpen.forbidden" : "attachmentOpen.openFailed")}
            </DialogDescription>
            <DialogFooter><DialogClose asChild><Button>{t("common.close")}</Button></DialogClose></DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
);
AttachmentExternalLink.displayName = "AttachmentExternalLink";
