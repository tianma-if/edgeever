import { Infographic, getTemplate, parseSyntax } from "@antv/infographic";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export default function ReadOnlyInfographic({ syntax }: { syntax: string }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!containerRef.current || !syntax.trim()) return;
    let instance: Infographic | undefined;
    try {
      const parsed = parseSyntax(syntax);
      if (parsed.errors.length || !parsed.options.template || !getTemplate(parsed.options.template)) {
        setFailed(true);
        return;
      }
      instance = new Infographic({
        container: containerRef.current,
        width: "100%",
        height: "100%",
        editable: false,
        svg: { style: { width: "100%", height: "auto", display: "block" } },
      });
      instance.on("error", () => setFailed(true));
      instance.render(syntax);
    } catch {
      setFailed(true);
    }
    return () => { instance?.destroy(); };
  }, [syntax]);

  return (
    <>
      <div ref={containerRef} role="img" aria-label={t("infographic.name")} className="w-full overflow-x-auto" hidden={failed} />
      {failed && <p role="alert" className="text-sm text-destructive">{t("infographic.renderError")}</p>}
    </>
  );
}
