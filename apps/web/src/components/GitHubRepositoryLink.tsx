import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const GITHUB_REPOSITORY_URL = "https://github.com/tianma-if/edgeever";

export const GitHubMark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.48 2 2 6.59 2 12.25c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.22-3.37-1.22-.46-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.33 9.33 0 0 1 12 6.97c.85 0 1.7.12 2.5.35 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9 0 1.38-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.18 10.18 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z"
    />
  </svg>
);

export const GitHubRepositoryLink = ({
  children,
  className,
  iconClassName,
}: {
  children?: ReactNode;
  className?: string;
  iconClassName?: string;
}) => {
  const { t } = useTranslation();
  const resolvedTitle = t("common.githubRepository");

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            aria-label={children ? undefined : resolvedTitle}
            className={cn("inline-flex items-center gap-2", className)}
            href={GITHUB_REPOSITORY_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GitHubMark className={cn("h-4 w-4 shrink-0", iconClassName)} />
            {children}
          </a>
        </TooltipTrigger>
        <TooltipContent side="bottom">{resolvedTitle}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
