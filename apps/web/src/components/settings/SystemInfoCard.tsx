import { ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SystemInfoPanel, type SystemInfoItem, getWebSystemInfoItems } from "./SystemInfoPanel";

export { getWebSystemInfoItems };
export type { SystemInfoItem };

export const SystemInfoCard = ({ defaultExpanded = false }: { defaultExpanded?: boolean }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card className="w-full min-w-0 overflow-hidden shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <CollapsibleTrigger asChild>
            <button className="flex w-full min-w-0 items-start justify-between gap-3 text-left" type="button">
              <span className="min-w-0">
                <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                  <Info className={SETTINGS_CARD_ICON_CLASSNAME} />
                  {t("systemInfo.title")}
                </CardTitle>
                <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>{t("systemInfo.description")}</CardDescription>
              </span>
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded ? "rotate-180" : "rotate-0")} />
            </button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="p-4 pt-0"><SystemInfoPanel active={expanded} /></CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
