import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export const ClipboardCopyNotice = ({
  children,
  status,
}: {
  children: ReactNode;
  status: "copied" | "error";
}) => {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-[120] inline-flex max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md px-3 py-2 text-sm font-medium text-white shadow-lg sm:max-w-xl",
        status === "copied" ? "bg-emerald-700" : "bg-rose-600",
      )}
      role={status === "copied" ? "status" : "alert"}
    >
      <span className="min-w-0 truncate">{children}</span>
    </div>,
    document.body,
  );
};
