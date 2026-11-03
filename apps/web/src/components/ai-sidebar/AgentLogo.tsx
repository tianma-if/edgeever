import type { DesktopAcpAdapterId } from "@/lib/desktop-acp";
import { cn } from "@/lib/utils";
import codex from "@/assets/agent-logos/codex.svg?url";
import claudeCode from "@/assets/agent-logos/claudecode-color.svg?url";
import antigravity from "@/assets/agent-logos/antigravity-color.svg?url";
import openClaw from "@/assets/agent-logos/openclaw-color.svg?url";
import hermesAgent from "@/assets/agent-logos/hermesagent.svg?url";
import grokBuild from "@/assets/agent-logos/grok.svg?url";
import deepseekHarness from "@/assets/agent-logos/deepseek-color.svg?url";
import piAgent from "@/assets/agent-logos/pi.svg?url";
import workbuddy from "@/assets/agent-logos/workbuddy.svg?url";
import codebuddy from "@/assets/agent-logos/codebuddy.svg?url";

const logos: Record<DesktopAcpAdapterId, { src: string; monochrome?: boolean }> = {
  codex: { src: codex, monochrome: true },
  claudeCode: { src: claudeCode },
  antigravity: { src: antigravity },
  openClaw: { src: openClaw },
  hermesAgent: { src: hermesAgent, monochrome: true },
  grokBuild: { src: grokBuild, monochrome: true },
  deepseekHarness: { src: deepseekHarness },
  piAgent: { src: piAgent, monochrome: true },
  workbuddyCn: { src: workbuddy },
  workbuddyIntl: { src: workbuddy },
  codebuddy: { src: codebuddy },
};

export function AgentLogo({ id, className }: { id: DesktopAcpAdapterId; className?: string }) {
  const logo = logos[id];
  const classes = cn("size-4 shrink-0", className);
  // Masks let monochrome marks follow the surrounding text in any theme.
  return logo.monochrome ? (
    <span aria-hidden="true" className={cn(classes, "bg-current")}
      style={{ maskImage: `url("${logo.src}")`, maskSize: "contain", maskPosition: "center", maskRepeat: "no-repeat" }} />
  ) : (
    <img src={logo.src} alt="" aria-hidden="true" className={cn(classes, "object-contain")} />
  );
}
