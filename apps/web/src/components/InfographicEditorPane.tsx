import { AI_ASSISTANT_LAUNCHER_POSITION } from "@/lib/ai-assistant-launcher";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Download, FileCode2, FileImage, LayoutTemplate, LoaderCircle, Pencil, Sparkles } from "lucide-react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { INFOGRAPHIC_AGENT_SOURCE_MAX_LENGTH, markdownToDoc, infographicFallbackMarkdown, parseInfographicDocument, serializeInfographicDocument, type InfographicConversationTurn, type InfographicDocument, type MemoDetail, type MemoEditSession, type Notebook } from "@edgeever/shared";
import type { Infographic as InfographicInstance, SyntaxParseResult } from "@antv/infographic";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfographicGallery } from "./InfographicGallery";
import type { InfographicSample } from "@/lib/infographic-samples";
import { AiSidebar, readAiSidebarOpen, writeAiSidebarOpen } from "@/components/ai-sidebar/AiSidebar";
import { AiSidebarErrorBoundary } from "@/components/ai-sidebar/AiSidebarErrorBoundary";
import type { InfographicSidebarController } from "@/components/ai-sidebar/InfographicSidebarSession";
import { IconTooltip } from "@/components/editor/EditorPaneChrome";
import { MemoEditorHeaderActions } from "@/components/MemoEditorHeaderActions";
import { MemoEditorMetadataRow } from "@/components/MemoEditorMetadataRow";
import { MemoEditorFocusModeButton, MemoEditorTopRowLeading } from "@/components/MemoEditorTopRowLeading";
import { MEMO_EDITOR_METADATA_ROW_CLASS_NAME, MEMO_EDITOR_TOP_ROW_CLASS_NAME, nextTitleStatusClearance } from "@/components/MemoEditorChromeDensity";
import { MemoEditorToolbarDivider } from "@/components/MemoEditorToolbarChrome";
import { MemoTitleInput } from "@/components/MemoTitleInput";
import { api } from "@/lib/api";
import { readAiSidebarAdapter, readAiSidebarSource } from "@/lib/desktop-acp";
import { buildInfographicLocalAgentContext, collectInfographicLocalAgentText, infographicLocalAgentErrorKey, parseInfographicLocalReply } from "@/lib/infographic-local-agent";
import { formatShortcutBinding, getNotebookMoveOptions, type ShortcutSettings } from "@/lib/app-helpers";
import { createLocalEditSession, requiresLocalEditSession } from "@/components/editor/editor-pane-helpers";
import { canvasToPngBlob, downloadBlob, frameInfographicExportSvg, infographicExportBasename, rasterizeInfographicSvg, readInfographicSheetColor } from "@/lib/infographic-image-export";
import { buildInfographicSyntax, buildOfficialInfographicSyntax, infographicAgentCandidates, infographicNoteTitleIsAutomatic, infographicSyntaxTitle, INFOGRAPHIC_TEMPLATES, nextInfographicNoteTitle, parseGeneratedOfficialData, type InfographicItem } from "@/lib/infographic-generation";
import { statusSettleMotion } from "@/lib/motion";
import type { EdgeEverRepository } from "@/lib/repository";
import { cn, parseTagsText } from "@/lib/utils";

type Props = {
  memo: MemoDetail;
  notebooks: Notebook[];
  repository: EdgeEverRepository;
  readOnly: boolean;
  desktopFocusMode: boolean;
  onBackToList: () => void;
  onOpenExecutionCenter: () => void;
  onSaved: (memo: MemoDetail) => Promise<void>;
  onToggleDesktopFocusMode: () => void;
  aiAssistantOpenToken: number;
  shortcutSettings: ShortcutSettings;
  onOpenCompanionNote?: (id: string, notebookId: string) => void;
};

const plainLine = (value: string) => value.replace(/\s+/g, " ").trim();
const parseItemLine = (line: string) => {
  const [label, description] = line.split("|").map(plainLine);
  return { label, description };
};
const parseFormItems = (template: string, text: string): InfographicItem[] => {
  if (!template.startsWith("compare-binary-")) {
    return text.split("\n").map(parseItemLine).filter((item) => item.label);
  }
  const roots: Array<{ label: string; description?: string; children: Array<{ label: string; description?: string }> }> = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const child = /^\s+-\s+(.+)$/.exec(line);
    if (child) {
      const item = parseItemLine(child[1]);
      if (roots.length && item.label) roots[roots.length - 1].children.push(item);
    } else {
      const item = parseItemLine(line);
      if (item.label) roots.push({ ...item, children: [] });
    }
  }
  return roots;
};
const formatFormItems = (template: string, items: InfographicItem[]) =>
  template.startsWith("compare-binary-")
    ? items.flatMap((item) => [
      item.description ? `${item.label} | ${item.description}` : item.label,
      ...(item.children ?? []).map((child) => `  - ${child.label}${child.description ? ` | ${child.description}` : ""}`),
    ]).join("\n")
    : items.map((item) => item.description ? `${item.label} | ${item.description}` : item.label).join("\n");
const buildSyntax = (template: string, title: string, description: string, items: string, dark: boolean) =>
  buildInfographicSyntax({
    template, title, description, dark,
    items: parseFormItems(template, items),
  });

const parseSimpleForm = (syntax: string) => {
  const lines = syntax.trim().split("\n");
  const template = lines[0]?.match(/^infographic ([\w-]+)$/)?.[1];
  if (!template || !INFOGRAPHIC_TEMPLATES.some((item) => item.id === template)) return null;
  const dark = lines[1] === "theme dark";
  const dataIndex = dark ? 2 : 1;
  if (lines[dataIndex] !== "data") return null;
  let heading = "";
  let description = "";
  const items: string[] = [];
  let inList = false;
  const comparison = template.startsWith("compare-binary-");
  let comparisonChildIndex = 0;
  let comparisonRootIndex = -1;
  for (const line of lines.slice(dataIndex + 1)) {
    if (line.startsWith("  title ") && !inList) heading = line.slice(8);
    else if (line.startsWith("  desc ") && !inList) description = line.slice(7);
    else if (line === (template.startsWith("sequence-") ? "  sequences" : comparison || /^(compare-)?quadrant-/.test(template) ? "  compares" : "  lists")) inList = true;
    else if (comparison && line.startsWith("    - label ") && inList) {
      comparisonRootIndex = items.push(line.slice(12)) - 1;
      comparisonChildIndex = 0;
    }
    else if (comparison && line === "      children" && inList) continue;
    else if (comparison && line.startsWith("        - label ") && inList) {
      if (comparisonChildIndex > 0) items.push(`  - ${line.slice(16)}`);
      comparisonChildIndex += 1;
    }
    else if (comparison && line.startsWith("          desc ") && inList && items.length && comparisonChildIndex > 0) {
      const target = comparisonChildIndex === 1 ? comparisonRootIndex : items.length - 1;
      items[target] += ` | ${line.slice(15)}`;
    }
    else if (!comparison && line.startsWith("    - label ") && inList) items.push(line.slice(12));
    else if (!comparison && line.startsWith("      desc ") && inList && items.length) items[items.length - 1] += ` | ${line.slice(11)}`;
    else return null;
  }
  const itemText = items.join("\n");
  return buildSyntax(template, heading, description, itemText, dark) === syntax.trim()
    ? { template, heading, description, items: itemText, dark }
    : null;
};

type VisualTextChange = {
  changes?: Array<{ path: string; indexes?: number[]; value?: unknown }>;
};

const applyVisualTextChange = (syntax: string, payload: VisualTextChange) => {
  const form = parseSimpleForm(syntax);
  if (!form || !payload.changes?.length) return null;
  const formItems = parseFormItems(form.template, form.items);
  let changed = false;
  for (const change of payload.changes) {
    if (typeof change.value === "string" && change.path === "data.title") {
      form.heading = plainLine(change.value);
    } else if (typeof change.value === "string" && change.path === "data.desc") {
      form.description = plainLine(change.value);
    } else if (change.path === "data.items" && change.indexes && change.value && typeof change.value === "object") {
      const comparison = form.template.startsWith("compare-binary-");
      if (comparison ? change.indexes.length !== 2 : change.indexes.length !== 1) return null;
      const index = change.indexes[0];
      if (!Number.isInteger(index) || index < 0 || index >= formItems.length) return null;
      const value = change.value as Record<string, unknown>;
      const childIndex = comparison ? change.indexes[1] : 0;
      const item = comparison && childIndex > 0 ? formItems[index].children?.[childIndex - 1] : formItems[index];
      if (!item) return null;
      const label = typeof value.label === "string" ? plainLine(value.label) : item.label;
      const description = typeof value.desc === "string" ? plainLine(value.desc) : item.description;
      if (!label) return null;
      item.label = label;
      item.description = description;
    } else {
      return null;
    }
    changed = true;
  }
  return changed ? buildSyntax(form.template, form.heading, form.description, formatFormItems(form.template, formItems), form.dark) : null;
};

const editableOfficialData = (syntax: string, parsed: SyntaxParseResult) => {
  if (parsed.errors.length || !parsed.options.template || !parsed.options.data) return null;
  const data = parsed.options.data as Record<string, unknown>;
  const dark = syntax.split("\n")[1] === "theme dark";
  return buildOfficialInfographicSyntax(parsed.options.template, data, dark) === syntax.trim() ? { data, dark } : null;
};

const applyOfficialVisualTextChange = (syntax: string, payload: VisualTextChange, parsed: SyntaxParseResult) => {
  const editable = editableOfficialData(syntax, parsed);
  if (!editable || !payload.changes?.length || !parsed.options.template) return null;
  const data = structuredClone(editable.data);
  const items = (data.lists ?? data.sequences ?? data.compares ?? data.nodes ?? data.values ?? (data.root ? [data.root] : data.items)) as Array<Record<string, unknown>> | undefined;
  for (const change of payload.changes) {
    if (typeof change.value === "string" && change.path === "data.title") data.title = plainLine(change.value);
    else if (typeof change.value === "string" && change.path === "data.desc") data.desc = plainLine(change.value);
    else if (change.path === "data.items" && change.indexes?.length && change.value && typeof change.value === "object" && items) {
      let item: Record<string, unknown> | undefined = items[change.indexes[0]];
      for (const index of change.indexes.slice(1)) item = (item?.children as Array<Record<string, unknown>> | undefined)?.[index];
      if (!item) return null;
      const value = change.value as Record<string, unknown>;
      if (typeof value.label === "string") item.label = plainLine(value.label);
      if (typeof value.desc === "string") item.desc = plainLine(value.desc);
      if (typeof value.value === "number" && Number.isFinite(value.value)) item.value = value.value;
    } else return null;
  }
  return buildOfficialInfographicSyntax(parsed.options.template, data, editable.dark);
};

export default function InfographicEditorPane({
  memo,
  notebooks,
  repository,
  readOnly,
  desktopFocusMode,
  onBackToList,
  onOpenExecutionCenter,
  onSaved,
  onToggleDesktopFocusMode,
  aiAssistantOpenToken,
  shortcutSettings,
  onOpenCompanionNote,
}: Props) {
  const { t, i18n } = useTranslation();
  const parsed = useMemo(() => parseInfographicDocument(memo.contentMarkdown), [memo.contentMarkdown]);
  const initialTags = memo.tags.join(", ");
  const [title, setTitle] = useState(memo.title ?? "");
  const titleEditedByUserRef = useRef(!infographicNoteTitleIsAutomatic({
    noteTitle: memo.title ?? "",
    graphicTitle: infographicSyntaxTitle(parsed?.syntax ?? ""),
    defaultTitle: t("infographic.name"),
    earlierTitles: (parsed?.history ?? []).map((turn) => turn.resultTitle),
  }));
  const [tagsText, setTagsText] = useState(initialTags);
  const [syntax, setSyntax] = useState(parsed?.syntax ?? "");
  const [history, setHistory] = useState<InfographicConversationTurn[]>(parsed?.history ?? []);
  const [activeTurn, setActiveTurn] = useState<{ prompt: string; response: string; template?: string; decision?: string; question?: string } | null>(null);
  const [aiAssistantOpen, setAiAssistantOpenState] = useState(readAiSidebarOpen);
  const [previousGeneration, setPreviousGeneration] = useState<{ title: string; syntax: string; turnId: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(JSON.stringify([memo.title ?? "", parsed?.syntax ?? "", parsed?.history ?? [], initialTags]));
  const [savedHistorySnapshot, setSavedHistorySnapshot] = useState(JSON.stringify(parsed?.history ?? []));
  const [galleryDialogOpen, setGalleryDialogOpen] = useState(false);
  const [mobileNotebookSheetOpen, setMobileNotebookSheetOpen] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [headerTitleSlot, setHeaderTitleSlot] = useState<HTMLDivElement | null>(null);
  const [headerStatusCluster, setHeaderStatusCluster] = useState<HTMLDivElement | null>(null);
  const [titleStatusClearancePx, setTitleStatusClearancePx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<InfographicInstance | null>(null);
  const sessionRef = useRef<MemoEditSession | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const handledAiAssistantOpenTokenRef = useRef(aiAssistantOpenToken);
  const memoRef = useRef(memo);
  const tagsRef = useRef(initialTags);
  const saveRef = useRef<() => boolean | Promise<boolean>>(() => false);
  const snapshot = JSON.stringify([title, syntax, history, tagsText]);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const dirty = snapshot !== savedSnapshot;
  const historyDirty = JSON.stringify(history) !== savedHistorySnapshot;

  useEffect(() => {
    memoRef.current = memo;
  }, [memo]);

  useEffect(() => () => generationControllerRef.current?.abort(), []);

  const setAiSidebarOpen = useCallback((open: boolean) => {
    setAiAssistantOpenState(open);
    writeAiSidebarOpen(open);
  }, []);

  useEffect(() => {
    if (handledAiAssistantOpenTokenRef.current === aiAssistantOpenToken) return;
    handledAiAssistantOpenTokenRef.current = aiAssistantOpenToken;
    if (readOnly) return;
    setAiSidebarOpen(true);
  }, [aiAssistantOpenToken, readOnly, setAiSidebarOpen]);

  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    if (requiresLocalEditSession(memo)) {
      sessionRef.current = createLocalEditSession(memo);
      setReady(true);
      return;
    }
    void api.createMemoEditSession(memo.id).then(({ editSession }) => {
      if (!cancelled) { sessionRef.current = editSession; setReady(true); }
    }).catch(() => { if (!cancelled) setError(t("infographic.sessionError")); });
    return () => { cancelled = true; };
  }, [memo.id, readOnly, t]);

  useEffect(() => {
    setPreviewReady(false);
    if (!syntax.trim()) { instanceRef.current?.destroy(); instanceRef.current = null; setRenderError(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void import("@antv/infographic").then(({ Infographic, Interaction, DblClickEditText, SelectHighlight, parseSyntax, getTemplate }) => {
        if (cancelled || !containerRef.current) return;
        const parsedSyntax = parseSyntax(syntax);
        if (parsedSyntax.errors.length || !parsedSyntax.options.template || !getTemplate(parsedSyntax.options.template)) {
          setRenderError(parsedSyntax.errors[0]?.message ?? t("infographic.invalidSyntax"));
          instanceRef.current?.destroy(); instanceRef.current = null;
          return;
        }
        try {
          instanceRef.current?.destroy();
          const visualTextEditable = !readOnly && Boolean(parseSimpleForm(syntax) || editableOfficialData(syntax, parsedSyntax));
          class SelectGraphicElement extends Interaction {
            name = "select-graphic-element";
            private svg: SVGSVGElement | null = null;
            private handleClick = (event: MouseEvent) => {
              if (!(event.target instanceof Element)) return;
              if (event.target.closest('[contenteditable="true"]')) return;
              const text = event.target.closest('foreignObject[data-element-type="title"], foreignObject[data-element-type="desc"], foreignObject[data-element-type="item-label"], foreignObject[data-element-type="item-desc"]');
              const shape = event.target.closest('[data-element-type="shape"], [data-element-type="item-icon"], [data-element-type="edit-area"]');
              let target = text ?? shape ?? event.target.closest("rect, ellipse, circle, path, polygon, polyline, line, image, text");
              if (shape?.getAttribute("data-element-type") === "shape") {
                let group = shape.parentElement;
                while (group && group.parentElement?.getAttribute("data-element-type") !== "items-group") group = group.parentElement;
                if (group) target = group;
              }
              if (target) this.interaction.select([target as Parameters<typeof this.interaction.select>[0][number]], event.shiftKey ? "toggle" : "replace");
              else this.interaction.clearSelection();
            };
            private handleKeyDown = (event: KeyboardEvent) => {
              if (event.key === "Escape") this.interaction.clearSelection();
            };
            override init(options: Parameters<(typeof DblClickEditText)["prototype"]["init"]>[0]) {
              super.init(options);
              const svg = options.editor.getDocument();
              this.svg = svg;
              svg.addEventListener("click", this.handleClick);
              document.addEventListener("keydown", this.handleKeyDown);
            }
            override destroy() {
              this.svg?.removeEventListener("click", this.handleClick);
              document.removeEventListener("keydown", this.handleKeyDown);
            }
          }
          const instance = new Infographic({
            container: containerRef.current, width: "100%", height: "100%",
            editable: visualTextEditable,
            ...(visualTextEditable ? { interactions: [new SelectGraphicElement(), new DblClickEditText(), new SelectHighlight()], plugins: [] } : {}),
          });
          if (visualTextEditable) instance.on("selection:change", ({ previous, next }: { previous: Element[]; next: Element[] }) => {
            for (const element of previous) element.classList.remove("edgeever-infographic-selected-text");
            for (const element of next) {
              if (["title", "desc", "item-label", "item-desc"].includes((element as HTMLElement).dataset.elementType ?? "")) {
                element.classList.add("edgeever-infographic-selected-text");
              }
            }
          });
          if (visualTextEditable) instance.on("options:change", (payload: VisualTextChange) => {
            const nextSyntax = applyVisualTextChange(syntax, payload) ?? applyOfficialVisualTextChange(syntax, payload, parsedSyntax);
            if (!nextSyntax || nextSyntax === syntax) return;
            if (parseSyntax(nextSyntax).errors.length) return;
            setPreviousGeneration(null);
            setSyntax(nextSyntax);
          });
          instance.render(syntax);
          instanceRef.current = instance;
          setRenderError(null);
          setPreviewReady(true);
        } catch (caught) {
          console.error("Failed to render infographic", caught);
          setRenderError(caught instanceof Error ? caught.message : t("infographic.renderError"));
          instanceRef.current = null;
        }
      }).catch((caught) => {
        console.error("Failed to load @antv/infographic", caught);
        if (!cancelled) setRenderError(t("infographic.renderError"));
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [syntax, readOnly, t]);

  useEffect(() => () => { instanceRef.current?.destroy(); }, []);

  const undoGeneration = () => {
    if (!previousGeneration) return;
    setSyntax(previousGeneration.syntax);
    setTitle(previousGeneration.title);
    setHistory((turns) => turns.map((turn) => turn.id === previousGeneration.turnId ? { ...turn, undoneAt: new Date().toISOString() } : turn));
    setPreviousGeneration(null);
    setError(null);
  };

  const handleApplySample = (sample: InfographicSample, sampleSyntax: string, sampleTitle: string) => {
    if (readOnly) return;
    if (syntax.trim() && !window.confirm(t("infographic.galleryConfirmReplace"))) {
      return;
    }
    setPreviousGeneration(null);
    setSyntax(sampleSyntax);
    if (!title.trim() || title.trim() === t("infographic.name")) {
      setTitle(sampleTitle);
    }
    setGalleryDialogOpen(false);
    setError(null);
    setRenderError(null);
  };

  const save = async () => {
    if (readOnly || saving || !dirty || !ready || !sessionRef.current) return false;
    if (syntax.trim() && (renderError || !previewReady || !instanceRef.current)) {
      setError(renderError ?? t("infographic.invalidSyntax"));
      return false;
    }
    const currentMemo = memoRef.current;
    const currentSnapshot = snapshot;
    const document: InfographicDocument = { schemaVersion: 1, syntax, ...(history.length ? { history } : {}) };
    setSaving(true); setError(null);
    try {
      const result = await repository.updateMemo(currentMemo, {
        expectedRevision: currentMemo.revision,
        expectedContentHash: currentMemo.contentHash,
        editSessionId: sessionRef.current.id,
        title,
        contentJson: markdownToDoc(infographicFallbackMarkdown(document)),
        contentMarkdown: serializeInfographicDocument(document),
        tags: parseTagsText(tagsRef.current),
      });
      memoRef.current = result.memo;
      setSavedSnapshot(currentSnapshot);
      setSavedHistorySnapshot(JSON.stringify(history));
      await onSaved(result.memo);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("infographic.saveError"));
      return false;
    } finally { setSaving(false); }
  };
  saveRef.current = () => save();

  const handleNotebookChange = (notebookId: string) => {
    const currentMemo = memoRef.current;
    if (readOnly || notebookUpdatePending || notebookId === currentMemo.notebookId) {
      setMobileNotebookSheetOpen(false);
      return;
    }
    setNotebookUpdatePending(true);
    setError(null);
    void (async () => {
      if (dirty && !(await save())) return;
      const sourceMemo = memoRef.current;
      await repository.moveMemos({ memoIds: [sourceMemo.id], notebookId });
      const { memo: movedMemo } = await repository.getMemo(sourceMemo.id);
      memoRef.current = movedMemo;
      await onSaved(movedMemo);
    })().catch((caught) => {
      setError(caught instanceof Error ? caught.message : t("infographic.saveError"));
    }).finally(() => {
      setNotebookUpdatePending(false);
      setMobileNotebookSheetOpen(false);
    });
  };

  useEffect(() => {
    if (!dirty || !ready || readOnly || saving || generating || renderError || (syntax.trim() && !previewReady)) return;
    const timer = window.setTimeout(() => saveRef.current(), historyDirty ? 0 : 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, ready, readOnly, saving, generating, renderError, previewReady, snapshot, syntax, historyDirty]);

  useLayoutEffect(() => {
    const titleSlot = headerTitleSlot;
    const status = headerStatusCluster;
    if (!titleSlot || !status) return;
    let frame = 0;
    const measure = () => {
      const titleRect = titleSlot.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      if (titleRect.width < 1 || statusRect.width < 1) return;
      const paddingRight = Number.parseFloat(getComputedStyle(titleSlot).paddingRight) || 0;
      const inputRight = titleRect.right - paddingRight;
      setTitleStatusClearancePx((current) => nextTitleStatusClearance(current, inputRight, statusRect.left));
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(titleSlot);
    observer.observe(status);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [dirty, headerStatusCluster, headerTitleSlot, saving]);

  const generate = async (message: string) => {
    const promptText = message.trim();
    if (!promptText || generating || readOnly) throw new Error("empty");
    setGenerating(true); setError(null); setActiveTurn({ prompt: promptText, response: "" }); setAiSidebarOpen(true);
    const controller = new AbortController();
    generationControllerRef.current = controller;
    let response = "";
    let proposal: { template: string; data: Record<string, unknown>; explanation: string } | null = null;
    let question = "";
    try {
      const { parseSyntax, getTemplate, getTemplates } = await import("@antv/infographic");
      const existingOptions = parseSyntax(syntax).options;
      const existingTemplate = existingOptions.template;
      const currentContent = existingTemplate && existingOptions.data
        ? JSON.stringify({ template: existingTemplate, data: existingOptions.data }) : syntax;
      if (currentContent.length > INFOGRAPHIC_AGENT_SOURCE_MAX_LENGTH) throw new Error(t("infographic.contentTooLarge"));
      const candidates = infographicAgentCandidates(promptText, getTemplates(), existingTemplate);
      if (!candidates.length) throw new Error(t("infographic.aiInvalidResponse"));
      const agentHistory = history.filter((turn) => !turn.undoneAt && turn.kind !== "failed")
        .slice(-12).map((turn) => ({ prompt: turn.prompt, response: `${turn.kind === "clarified" ? "No infographic change was applied. Clarification: " : ""}${turn.response || turn.resultTitle}${turn.decision ? `\nDecision: ${turn.decision}` : ""}`.slice(0, 2000) }));
      if (readAiSidebarSource() === "local") {
        const adapter = readAiSidebarAdapter();
        if (!adapter) throw new Error(t("aiAssistant.sidebar.localMissing"));
        let raw = "";
        try {
          raw = await collectInfographicLocalAgentText({
            request: {
              adapterId: adapter.id,
              ...(adapter.path ? { path: adapter.path } : {}),
              prompt: promptText,
              contextText: buildInfographicLocalAgentContext({
                prompt: promptText,
                ...(existingTemplate ? { currentTemplate: existingTemplate } : {}),
                currentContent,
                candidates,
                history: agentHistory,
              }),
              noteAccess: false,
            },
            signal: controller.signal,
            onText: (text) => {
              response = text;
              setActiveTurn((current) => current ? { ...current, response: text } : current);
            },
          });
        } catch (caught) {
          if (controller.signal.aborted) throw caught;
          const message = caught instanceof Error ? caught.message : "";
          const key = infographicLocalAgentErrorKey(message, adapter.id);
          throw new Error(key ? t(key) : message || t("infographic.aiError"));
        }
        const reply = parseInfographicLocalReply(raw, candidates, promptText);
        response = reply.visibleText;
        if (reply.proposal) {
          proposal = reply.proposal;
          setActiveTurn((current) => current ? { ...current, response, template: reply.proposal?.template, decision: reply.proposal?.explanation } : current);
        } else if (reply.question) {
          question = reply.question;
          setActiveTurn((current) => current ? { ...current, response, question } : current);
        } else throw new Error(t("infographic.aiInvalidResponse"));
      } else await api.streamInfographicAgent({
        prompt: promptText,
        locale: i18n.resolvedLanguage,
        ...(existingTemplate ? { currentTemplate: existingTemplate } : {}),
        currentContent,
        candidates,
        history: agentHistory,
      }, { signal: controller.signal, onEvent: (event) => {
        if (event.type === "text-delta") {
          response += event.text;
          setActiveTurn((current) => current ? { ...current, response } : current);
        }
        if (event.type === "proposal") {
          proposal = event;
          setActiveTurn((current) => current ? { ...current, template: event.template, decision: event.explanation } : current);
        }
        if (event.type === "question") {
          question = event.question;
          setActiveTurn((current) => current ? { ...current, question } : current);
        }
        if (event.type === "error") throw new Error(event.message);
      } });
      if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
      if (proposal) {
        const selected = proposal as { template: string; data: Record<string, unknown>; explanation: string };
        if (!candidates.includes(selected.template)) throw new Error(t("infographic.aiInvalidResponse"));
        const data = parseGeneratedOfficialData(JSON.stringify({ data: selected.data }), selected.template);
        if (!data) throw new Error(t("infographic.aiInvalidResponse"));
        const candidate = buildOfficialInfographicSyntax(selected.template, data, syntax.split("\n")[1] === "theme dark");
        const parsedCandidate = parseSyntax(candidate);
        if (parsedCandidate.errors.length || !parsedCandidate.options.template || !getTemplate(parsedCandidate.options.template)) throw new Error(t("infographic.aiInvalidResponse"));
        const generatedTitle = String(data.title ?? "");
        const turnId = crypto.randomUUID();
        const previousGraphicTitle = String(existingOptions.data?.title ?? "");
        const nextTitle = nextInfographicNoteTitle({
          noteTitle: title,
          previousGraphicTitle,
          nextGraphicTitle: generatedTitle,
          defaultTitle: t("infographic.name"),
          keepCustomTitle: titleEditedByUserRef.current,
        });
        setPreviousGeneration({ title, syntax, turnId });
        setHistory((turns) => [...turns, {
          id: turnId, prompt: promptText, createdAt: new Date().toISOString(),
          kind: syntax.trim() ? "refined" : "generated", resultTitle: generatedTitle,
          response: (response.trim() || selected.explanation).slice(0, 4000), decision: selected.explanation.slice(0, 500), template: selected.template,
        }]);
        setSyntax(candidate);
        if (nextTitle !== title) setTitle(nextTitle);
      } else if (question) {
        setHistory((turns) => [...turns, { id: crypto.randomUUID(), prompt: promptText, createdAt: new Date().toISOString(), kind: "clarified", resultTitle: "", response: (response.trim() || question).slice(0, 4000) }]);
      } else throw new Error(t("infographic.aiInvalidResponse"));
    } catch (caught) {
      if (controller.signal.aborted) throw caught;
      const messageText = caught instanceof Error ? caught.message : t("infographic.aiError");
      setError(messageText);
      setHistory((turns) => [...turns, { id: crypto.randomUUID(), prompt: promptText, createdAt: new Date().toISOString(), kind: "failed", resultTitle: "", response: response.slice(0, 4000), error: messageText.slice(0, 1000) }]);
      throw caught instanceof Error ? caught : new Error(messageText);
    } finally { if (generationControllerRef.current === controller) generationControllerRef.current = null; setActiveTurn(null); setGenerating(false); }
  };

  const exportImage = async (type: "svg" | "png") => {
    const svg = containerRef.current?.querySelector("svg");
    if (!(svg instanceof SVGSVGElement) || renderError || !previewReady) return;
    try {
      const { exportToSVG } = await import("@antv/infographic");
      const exported = await exportToSVG(svg);
      const sheetColor = readInfographicSheetColor(containerRef.current?.parentElement ?? null, syntax.split("\n")[1] === "theme dark");
      frameInfographicExportSvg(exported, sheetColor);
      const basename = infographicExportBasename(title.trim() || t("infographic.name"));
      if (type === "svg") {
        downloadBlob(new Blob([new XMLSerializer().serializeToString(exported)], { type: "image/svg+xml;charset=utf-8" }), `${basename}.svg`);
        return;
      }
      downloadBlob(await canvasToPngBlob(await rasterizeInfographicSvg(exported, sheetColor)), `${basename}.png`);
    } catch {
      setError(t("infographic.exportError"));
    }
  };

  const previewUsesLightSheet = Boolean(syntax.trim()) && syntax.split("\n")[1] !== "theme dark";
  const saveStatus = saving ? "saving" : dirty ? "unsaved" : "saved";
  const saveLabel = t(`editor.saveState.${saveStatus}`);
  const saveStatusClassName = saveStatus === "saved" ? "text-slate-400" : "bg-slate-100 text-slate-700";
  const infographicAssistant: InfographicSidebarController = {
    turns: history,
    activeTurn,
    generating,
    readOnly,
    canUndo: Boolean(previousGeneration),
    hasGraphic: Boolean(syntax.trim()),
    onSubmit: generate,
    onUndo: undoGeneration,
    onStop: () => generationControllerRef.current?.abort(),
  };

  return <div className="relative flex h-full min-h-0 min-w-0 bg-card text-foreground">
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
    <header className="shrink-0 border-b border-slate-200 bg-card">
      <div className={cn(MEMO_EDITOR_TOP_ROW_CLASS_NAME, "border-b-0")}>
        <div className="min-w-0 w-full" style={titleStatusClearancePx > 0 ? { paddingRight: titleStatusClearancePx } : undefined}>
          <div ref={setHeaderTitleSlot} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 sm:flex-nowrap">
            <MemoEditorTopRowLeading
              mobileBackButton={(
                <IconTooltip label={t("common.back")}>
                  <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBackToList} aria-label={t("common.back")}><ChevronLeft className="h-4 w-4" /></Button>
                </IconTooltip>
              )}
              titleInput={(
                <MemoTitleInput className="w-full min-w-0 px-2" value={title} onValueChange={(value) => { titleEditedByUserRef.current = true; setTitle(value); }} placeholder={t("infographic.name")} readOnly={readOnly} />
              )}
            />
            <MemoEditorMetadataRow
              rowClassName={MEMO_EDITOR_METADATA_ROW_CLASS_NAME}
              contentMarkdown={syntax}
              disabled={readOnly}
              mobileNotebookPickerOpen={mobileNotebookSheetOpen}
              notebookOptions={notebookOptions}
              notebookUpdatePending={notebookUpdatePending || saving}
              repository={repository}
              selectedNotebookId={memoRef.current.notebookId}
              tagsText={tagsText}
              title={title}
              onMobileNotebookPickerOpenChange={setMobileNotebookSheetOpen}
              onNotebookChange={handleNotebookChange}
              onTagsChange={(nextTagsText) => {
                tagsRef.current = nextTagsText;
                setTagsText(nextTagsText);
              }}
            />
          </div>
        </div>
        <div ref={setHeaderStatusCluster} className="absolute right-1 top-0 flex h-full shrink-0 items-center gap-1 sm:right-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {readOnly ? <span className="text-xs text-slate-500">{t("infographic.readOnly")}</span> : (
              <>
                <m.span key={`mobile-${saveStatus}`} className={cn("inline-flex max-w-[5.5rem] truncate rounded-full px-2 py-1 text-xs font-medium sm:hidden", saveStatus === "saved" ? "bg-slate-100 text-slate-500" : saveStatusClassName)} role="status" {...statusSettleMotion}>{saveLabel}</m.span>
                <m.span key={saveStatus} className={cn("hidden items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium sm:inline-flex", saveStatus === "saved" ? "px-1 text-slate-400" : saveStatusClassName)} role="status" {...statusSettleMotion}>
                  {saveStatus === "saving" ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" /> : saveStatus === "unsaved" ? <Pencil className="h-3 w-3" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
                  {saveLabel}
                </m.span>
              </>
            )}
          </div>
          <MemoEditorToolbarDivider className="mx-0.5 hidden h-4 sm:block" />
          <div className="flex items-center gap-0.5">
            <MemoEditorFocusModeButton desktopFocusMode={desktopFocusMode} onToggleDesktopFocusMode={onToggleDesktopFocusMode} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => setGalleryDialogOpen(true)}
              aria-label={t("infographic.galleryTemplatesButton")}
            >
              <LayoutTemplate className="h-4 w-4 text-slate-500" />
              <span className="hidden sm:inline">{t("infographic.galleryTemplatesButton")}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  data-infographic-export=""
                  disabled={!previewReady || Boolean(renderError)}
                  aria-label={t("infographic.export")}
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("infographic.export")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem className="gap-2" disabled={!previewReady || Boolean(renderError)} onClick={() => void exportImage("png")}>
                  <FileImage className="h-4 w-4 text-slate-500" />
                  {t("infographic.exportPng")}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" disabled={!previewReady || Boolean(renderError)} onClick={() => void exportImage("svg")}>
                  <FileCode2 className="h-4 w-4 text-slate-500" />
                  {t("infographic.exportSvg")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <MemoEditorHeaderActions
              moreMenuClassName="w-48"
              onOpenExecutionCenter={onOpenExecutionCenter}
              moreMenuItems={(
                <>
                  <DropdownMenuItem onClick={() => setGalleryDialogOpen(true)}>
                    <LayoutTemplate className="h-4 w-4 text-slate-500" />
                    {t("infographic.galleryTitle")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!previewReady || Boolean(renderError)} onClick={() => void exportImage("svg")}>
                    <FileCode2 className="h-4 w-4 text-slate-500" />
                    {t("infographic.exportSvg")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!previewReady || Boolean(renderError)} onClick={() => void exportImage("png")}>
                    <FileImage className="h-4 w-4 text-slate-500" />
                    {t("infographic.exportPng")}
                  </DropdownMenuItem>
                </>
              )}
            />
          </div>
        </div>
      </div>
    </header>
    {error ? <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">{error}</p> : null}
    <section className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
      {!syntax.trim() ? (
        <div className="relative min-h-full rounded-xl border border-slate-200 bg-white p-2 sm:p-4 shadow-sm">
          <div ref={containerRef} className="edgeever-infographic-preview hidden" />
          <InfographicGallery
            readOnly={readOnly}
            onSelect={handleApplySample}
          />
        </div>
      ) : (
        <div className={`relative flex min-h-full flex-col rounded-xl border border-slate-200 p-4 shadow-sm ${previewUsesLightSheet ? "bg-white" : "bg-card"}`}>
          <div ref={containerRef} className="edgeever-infographic-preview min-h-[380px] w-full flex-1" />
          {renderError ? <p role="alert" className="text-sm text-destructive">{renderError}</p> : null}
        </div>
      )}
    </section>
    {!readOnly && !aiAssistantOpen ? (
      <IconTooltip
        side="left"
        label={`${t("aiAssistant.open")} (${formatShortcutBinding(shortcutSettings.openAiAssistant)})`}
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          data-ai-assistant-launcher=""
          className={`${AI_ASSISTANT_LAUNCHER_POSITION} absolute z-30 size-11 rounded-full border-slate-200 bg-card text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.14)] hover:bg-card hover:text-slate-950`}
          aria-label={t("aiAssistant.open")}
          onClick={() => setAiSidebarOpen(true)}
        >
          <Sparkles className="size-5" strokeWidth={1.75} />
        </Button>
      </IconTooltip>
    ) : null}
    </div>
    <AiSidebarErrorBoundary open={aiAssistantOpen} onOpenChange={setAiSidebarOpen}>
      <AiSidebar
        open={aiAssistantOpen}
        onOpenChange={setAiSidebarOpen}
        companionAvailable={false}
        contentMarkdown={syntax}
        memoId={memo.id}
        notebookId={memo.notebookId}
        noteTitle={title}
        infographic={infographicAssistant}
        onOpenCompanionNote={onOpenCompanionNote}
      />
    </AiSidebarErrorBoundary>
    <Dialog open={galleryDialogOpen} onOpenChange={setGalleryDialogOpen}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("infographic.galleryTitle")}</DialogTitle>
          <DialogDescription>{t("infographic.galleryTitle")}</DialogDescription>
        </DialogHeader>
        <InfographicGallery
          readOnly={readOnly}
          isDialog
          onSelect={handleApplySample}
        />
      </DialogContent>
    </Dialog>
  </div>;
}
