import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo } from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { rewriteSidebarNoteLinks, sidebarNoteLinkAllowedTags, sidebarNoteLinkComponents } from "./sidebar-note-links";

const sidebarStreamdownPlugins = { cjk, code, mermaid, math };

export const AiSidebarMessage = memo(
  ({ className, children, isAnimating }: { children: string; className?: string; isAnimating?: boolean }) => (
    <Streamdown
      allowedTags={sidebarNoteLinkAllowedTags}
      className={cn("ai-sidebar-message size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      components={sidebarNoteLinkComponents}
      isAnimating={isAnimating}
      plugins={sidebarStreamdownPlugins}
      tableMaxHeight={240}
    >
      {rewriteSidebarNoteLinks(children)}
    </Streamdown>
  ),
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating && prev.className === next.className,
);

AiSidebarMessage.displayName = "AiSidebarMessage";
