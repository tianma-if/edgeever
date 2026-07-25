import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SvgXml } from "react-native-svg";
import LocalTiptapEditor from "./LocalTiptapEditor";
import { getMermaidSvgAspectRatio, sanitizeMobileMermaidSvg } from "../lib/mobile-mermaid";

type MermaidResult = { source: string; svg: string | null };
type MermaidContextValue = {
  register: (source: string) => () => void;
  results: ReadonlyMap<string, string | null>;
};

const MermaidContext = createContext<MermaidContextValue | null>(null);

export const MobileMermaidProvider = ({
  children,
  theme,
}: {
  children: ReactNode;
  theme: "light" | "dark";
}) => {
  const [sources, setSources] = useState<string[]>([]);
  const [results, setResults] = useState<ReadonlyMap<string, string | null>>(new Map());
  const sourceCountsRef = useRef(new Map<string, number>());
  const diagramsJson = useMemo(() => JSON.stringify(sources), [sources]);
  const register = useCallback((source: string) => {
    const count = sourceCountsRef.current.get(source) ?? 0;
    sourceCountsRef.current.set(source, count + 1);
    if (count === 0) {
      setSources((current) => [...current, source]);
    }
    return () => {
      const nextCount = (sourceCountsRef.current.get(source) ?? 1) - 1;
      if (nextCount > 0) {
        sourceCountsRef.current.set(source, nextCount);
        return;
      }
      sourceCountsRef.current.delete(source);
      setSources((current) => current.filter((item) => item !== source));
    };
  }, []);
  const handleRendered = useCallback(async (resultsJson: string) => {
    try {
      const parsed = JSON.parse(resultsJson) as MermaidResult[];
      setResults(new Map(parsed.map((result) => [result.source, result.svg])));
    } catch {
      setResults(new Map());
    }
  }, []);
  const contextValue = useMemo<MermaidContextValue>(() => ({
    register,
    results,
  }), [register, results]);

  useEffect(() => {
    setResults(new Map());
  }, [theme]);

  return (
    <MermaidContext.Provider value={contextValue}>
      {children}
      {sources.length > 0 ? (
        <LocalTiptapEditor
          diagramsJson={diagramsJson}
          dom={{
            bounces: false,
            containerStyle: styles.renderer,
            scrollEnabled: false,
            style: styles.renderer,
          }}
          onRendered={handleRendered}
          mode="mermaid-renderer"
          theme={theme}
        />
      ) : null}
    </MermaidContext.Provider>
  );
};

export const MobileMermaidDiagram = ({
  locale,
  source,
  theme,
}: {
  locale: "zh-CN" | "en-US";
  source: string;
  theme: "light" | "dark";
}) => {
  const context = useContext(MermaidContext);
  const register = context?.register;
  const { width } = useWindowDimensions();
  const normalizedSource = source.trim();

  useEffect(() => normalizedSource ? register?.(normalizedSource) : undefined, [normalizedSource, register]);

  if (!normalizedSource) {
    return <Text style={[styles.message, theme === "dark" && styles.messageDark]}>{locale === "en-US" ? "This Mermaid diagram is empty." : "此 Mermaid 图表暂无内容。"}</Text>;
  }

  const hasResult = context?.results.has(normalizedSource) ?? false;
  const svg = context?.results.get(normalizedSource) ?? null;
  if (!hasResult) {
    return <Text style={[styles.message, theme === "dark" && styles.messageDark]}>{locale === "en-US" ? "Rendering diagram…" : "正在渲染图表…"}</Text>;
  }
  if (!svg) {
    return <Text accessibilityRole="alert" style={styles.error}>{locale === "en-US" ? "Unable to render this Mermaid diagram. Check its syntax." : "无法渲染此 Mermaid 图表，请检查语法。"}</Text>;
  }

  const aspectRatio = getMermaidSvgAspectRatio(svg);
  const availableWidth = Math.max(1, width - 32);
  const height = Math.min(440, Math.max(120, availableWidth / aspectRatio));
  const nativeSvg = sanitizeMobileMermaidSvg(svg);
  return (
    <View accessibilityLabel={locale === "en-US" ? "Mermaid diagram" : "Mermaid 图表"} accessible style={[styles.diagram, theme === "dark" && styles.diagramDark, { height }]}>
      <SvgXml height="100%" width="100%" xml={nativeSvg} />
    </View>
  );
};

const styles = StyleSheet.create({
  diagram: {
    width: "100%",
    marginVertical: 14,
    backgroundColor: "transparent",
  },
  diagramDark: {
    backgroundColor: "transparent",
  },
  error: {
    marginVertical: 10,
    borderRadius: 10,
    padding: 12,
    color: "#be123c",
    backgroundColor: "#fff1f2",
    fontSize: 14,
    lineHeight: 20,
  },
  message: {
    marginVertical: 10,
    borderRadius: 10,
    padding: 12,
    color: "#64748b",
    backgroundColor: "#f8fafc",
    fontSize: 14,
    lineHeight: 20,
  },
  messageDark: {
    color: "#cbd5e1",
    backgroundColor: "#1e293b",
  },
  renderer: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
