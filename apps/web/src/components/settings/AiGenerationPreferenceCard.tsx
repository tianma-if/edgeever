import { RadioTower } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  readAiStreamingPreference,
  writeAiStreamingPreference,
} from "@/lib/ai-generation-preference";

export const AiGenerationPreferenceCard = () => {
  const { t } = useTranslation();
  const [streamingEnabled, setStreamingEnabled] = useState(readAiStreamingPreference);

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <RadioTower className="h-4 w-4 text-emerald-700" />
          {t("settings.aiGenerationTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex min-h-16 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{t("settings.aiStreamingTitle")}</div>
            <div className="mt-0.5 text-xs leading-5 text-slate-500">{t("settings.aiStreamingDescription")}</div>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:w-44 sm:justify-end">
            <Switch
              checked={streamingEnabled}
              onCheckedChange={(enabled) => {
                writeAiStreamingPreference(enabled);
                setStreamingEnabled(enabled);
              }}
              aria-label={t("settings.aiStreamingAria")}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
