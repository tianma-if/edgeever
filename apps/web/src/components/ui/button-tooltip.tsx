import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

interface ButtonTooltipProps {
  children: ReactNode;
  title: string;
}

export const ButtonTooltip = ({ children, title }: ButtonTooltipProps) => (
  <TooltipProvider delayDuration={0} skipDelayDuration={0}>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{title}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
