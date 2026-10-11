import { AI_ASSISTANT_LAUNCHER_POSITION } from "@/lib/ai-assistant-launcher";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  Grid3X3,
  Hand,
  ImagePlus,
  LoaderCircle,
  MousePointer2,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  RectangleHorizontal,
  Redo2,
  Save,
  ScanLine,
  Shapes,
  Sparkles,
  Type,
  Undo2,
} from "lucide-react";
import { PencilBrush, Textbox, type FabricObject } from "fabric";
import {
  parsePosterDocument,
  posterFallbackMarkdown,
  PosterDocumentSchema,
  createPosterDocument,
  resizePosterDocument,
  type MemoDetail,
  type MemoEditSession,
  type Notebook,
  type PosterDocument,
  type PosterElement,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { api } from "@/lib/api";
import type { EdgeEverRepository } from "@/lib/repository";
import {
  Canvas,
  ActiveSelection,
  makePosterGradient,
  posterObject,
  posterElementFromObject,
  renderPosterBlob,
} from "@/lib/poster-canvas";
import {
  buildPosterDesign,
  PLATFORMS,
  posterCopy,
  posterPrimitiveFromObject,
  platformFor,
} from "@/lib/poster-design/templates";
import { canRestorePosterDraft, classifyPosterUpdate, posterMemoContent, savePosterMemo } from "@/lib/poster-save";
import { copyImageBlobToClipboard } from "@/lib/clipboard";
import { compressImageForUpload } from "@/lib/image-compression";
import {
  createLocalEditSession,
  requiresLocalEditSession,
} from "./editor/editor-pane-helpers";
import { downloadBlob } from "@/lib/infographic-image-export";
import { PosterTool } from "./poster/PosterControls";
import { PosterTemplatePanel } from "./poster/PosterTemplatePanel";
import { PosterInspector, type PosterAlign } from "./poster/PosterInspector";
import { PosterCanvasSettings } from "./poster/PosterCanvasSettings";
import { PosterLayers } from "./poster/PosterLayers";
import { PosterAssetsPanel } from "./poster/PosterAssetsPanel";
import { z } from "zod";
import { MemoEditorHeaderActions } from "./MemoEditorHeaderActions";
import { MemoEditorMetadataRow } from "./MemoEditorMetadataRow";
import { MemoEditorFocusModeButton, MemoEditorTopRowLeading } from "./MemoEditorTopRowLeading";
import { MEMO_EDITOR_TOP_ROW_CLASS_NAME, MEMO_EDITOR_METADATA_ROW_CLASS_NAME } from "./MemoEditorChromeDensity";
import { MemoTitleInput } from "./MemoTitleInput";
import { IconTooltip } from "./editor/EditorPaneChrome";
import { AiSidebar, readAiSidebarOpen, writeAiSidebarOpen } from "./ai-sidebar/AiSidebar";
import { AiSidebarErrorBoundary } from "./ai-sidebar/AiSidebarErrorBoundary";
import { getNotebookMoveOptions } from "@/lib/app-helpers";
import { parseTagsText } from "@/lib/utils";

const artwork = (document: PosterDocument) =>
  JSON.stringify({ ...document, previewResourceId: undefined });
const snapshot = (title: string, document: PosterDocument) =>
  JSON.stringify([title, artwork(document)]);
type Props = {
  memo: MemoDetail;
  repository: EdgeEverRepository;
  readOnly: boolean;
  companionAvailable?: boolean;
  beforeCompanionApply?: () => Promise<void>;
  onCompanionNotesChanged?: () => Promise<void>;
  onSaved: (memo: MemoDetail) => Promise<void>;
  onBackToList: () => void;
  onOpenCompanionNote?: (id: string, notebookId: string) => void;
  notebooks?: Notebook[];
  desktopFocusMode?: boolean;
  onOpenExecutionCenter?: () => void;
  onToggleDesktopFocusMode?: () => void;
  aiAssistantOpenToken?: number;
  shortcutSettings?: unknown;
};
export default function PosterEditorPane({
  memo,
  repository,
  readOnly,
  onSaved,
  onBackToList,
  onOpenCompanionNote,
  notebooks = [], desktopFocusMode = false, onToggleDesktopFocusMode,
  onOpenExecutionCenter, aiAssistantOpenToken,
  companionAvailable = false, beforeCompanionApply, onCompanionNotesChanged,
}: Props) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const initial = useMemo(
    () => parsePosterDocument(memo.contentMarkdown),
    [memo.contentMarkdown],
  );
  const [document, setDocument] = useState<PosterDocument>(
    initial ?? createPosterDocument(),
  );
  const [aiAssistantOpen, setAiAssistantOpen] = useState(readAiSidebarOpen);
  const setAiSidebarOpen = useCallback((open: boolean) => {
    setAiAssistantOpen(open);
    writeAiSidebarOpen(open);
  }, []);
  const handledAiToken = useRef(aiAssistantOpenToken);
  useEffect(() => {
    if (handledAiToken.current === aiAssistantOpenToken) return;
    handledAiToken.current = aiAssistantOpenToken;
    if (!readOnly) setAiSidebarOpen(true);
  }, [aiAssistantOpenToken, readOnly, setAiSidebarOpen]);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const [mobileNotebookPickerOpen, setMobileNotebookPickerOpen] = useState(false);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [tagsText, setTagsText] = useState(memo.tags.join(", "));
  const [savedTags, setSavedTags] = useState(memo.tags.join(", "));
  const [title, setTitle] = useState(memo.title ?? "");
  const [saved, setSaved] = useState(
    initial?.previewResourceId ? snapshot(memo.title ?? "", document) : "",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [canvasReady, setCanvasReady] = useState(false),
    [canvasRevision, setCanvasRevision] = useState(0),
    [saving, setSaving] = useState(false),
    [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(
    initial ? null : t("poster.invalid"),
  );
  const [leftTab, setLeftTab] = useState<"templates" | "assets">(
      "templates",
    ),
    [rightTab, setRightTab] = useState<"properties" | "layers" | "canvas">(
      "canvas",
    );
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 760),
    [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 1100);
  const [tool, setTool] = useState<"select" | "hand" | "draw">("select"),
    [spaceHeld, setSpaceHeld] = useState(false);
  const [brushColor, setBrushColor] = useState("#16a06e"),
    [brushWidth, setBrushWidth] = useState(8);
  const [zoom, setZoom] = useState(0.4),
    [fitZoom, setFitZoom] = useState(0.4),
    [autoFit, setAutoFit] = useState(true);
  const [grid, setGrid] = useState(false),
    [safeArea, setSafeArea] = useState(false),
    [snap, setSnap] = useState(true),
    [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [exportOpen, setExportOpen] = useState(false),
    [exportFormat, setExportFormat] = useState<"png" | "jpeg" | "webp">("png"),
    [exportScale, setExportScale] = useState(1),
    [exportQuality, setExportQuality] = useState(0.92);
  const [toast, setToast] = useState("");
  const [recovery, setRecovery] = useState<{
    title: string;
    document: PosterDocument;
    baseHash: string;
    baseContent?: string;
    tagsText?: string;
  } | null>(null);
  const [, setHistoryVersion] = useState(0);
  const workbenchHost = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    canvas = useRef<Canvas | null>(null);
  const objectsRef = useRef<FabricObject[]>([]);
  const selectionSync = useRef(false);
  const session = useRef<MemoEditSession | null>(null),
    currentMemo = useRef(memo);
  const previousSaveBase = useRef<MemoDetail | null>(null);
  const current = useRef({ title, document, tagsText });
  current.current = { title, document, tagsText };
  const selected = useRef(selectedIds);
  selected.current = selectedIds;
  const options = useRef({ zoom, snap, readOnly, busy, tool, spaceHeld });
  options.current = { zoom, snap, readOnly, busy, tool, spaceHeld };
  const loadedArt = useRef(artwork(document));
  const undo = useRef<PosterDocument[]>([]),
    redo = useRef<PosterDocument[]>([]);
  const saveLock = useRef<Promise<boolean> | null>(null),
    saveRef = useRef<() => Promise<boolean>>(async () => false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const actions = useRef<{ commit: typeof commit; add: typeof add }>(
    {} as never,
  );
  const panStart = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const draftKey = `edgeever:poster-draft:${memo.id}`;
  const dirty = snapshot(title, document) !== saved || tagsText !== savedTags;
  const editable = !readOnly && Boolean(initial) && ready && !busy;
  const selectedElements = document.elements.filter((element) =>
    selectedIds.includes(element.id),
  );
  const active =
    selectedElements.length === 1 ? selectedElements[0] : undefined;
  const platform = platformFor(
    document.width,
    document.height,
    document.platformId,
  );
  const readResource = useMemo(() => {
    const cache = new Map<string, Promise<Blob>>();
    return (id: string) => {
      if (!cache.has(id))
        cache.set(
          id,
          repository.readResource(id).catch((error) => {
            cache.delete(id);
            throw error;
          }),
        );
      return cache.get(id)!;
    };
  }, [repository]);

  const commit = (next: PosterDocument, redraw = true) => {
    const validated = PosterDocumentSchema.safeParse(next);
    if (!validated.success) {
      setError(t("poster.invalid"));
      if (!redraw) setCanvasRevision((version) => version + 1);
      return;
    }
    if (artwork(next) === artwork(current.current.document)) return;
    undo.current = [...undo.current.slice(-49), current.current.document];
    redo.current = [];
    current.current.document = validated.data;
    setDocument(validated.data);
    if (redraw) setCanvasRevision((version) => version + 1);
    setHistoryVersion((version) => version + 1);
    setError(null);
  };
  const patchIds = (
    ids: string[],
    patch: Partial<PosterElement>,
    allowLocked = false,
  ) => {
    const value = current.current.document;
    const next = {
      ...value,
      elements: value.elements.map((element) =>
        ids.includes(element.id) && (!element.locked || allowLocked)
          ? ({
              ...element,
              ...patch,
              ...("text" in patch && patch.text !== undefined
                ? { sourceText: patch.text }
                : {}),
            } as PosterElement)
          : element,
      ),
    };
    if ("text" in patch) {
      const copy = { ...posterCopy(value) };
      for (const role of ["title", "subtitle", "badge"] as const)
        if (
          value.elements.some(
            (element) =>
              ids.includes(element.id) &&
              element.role === role &&
              (!element.locked || allowLocked),
          )
        )
          copy[role] = next.elements
            .filter(
              (element) => element.type === "text" && element.role === role,
            )
            .map((element) =>
              element.type === "text"
                ? (element.sourceText ?? element.text)
                : "",
            )
            .join("\n");
      next.copy = copy;
    }
    commit(next);
  };
  const updateElement = (patch: Partial<PosterElement>) =>
    patchIds(selected.current, patch, "locked" in patch || "name" in patch);
  const travel = (back: boolean) => {
    const from = back ? undo.current : redo.current,
      to = back ? redo.current : undo.current;
    const next = from.pop();
    if (!next) return;
    to.push(current.current.document);
    current.current.document = next;
    setDocument(next);
    setCanvasRevision((version) => version + 1);
    setHistoryVersion((version) => version + 1);
  };
  const syncSelection = (ids: string[]) => {
    setSelectedIds(ids);
    selected.current = ids;
    const instance = canvas.current;
    if (!instance) return;
    selectionSync.current = true;
    instance.discardActiveObject();
    const objects = objectsRef.current.filter((_, index) =>
      ids.includes(current.current.document.elements[index]?.id),
    );
    if (objects.length === 1) instance.setActiveObject(objects[0]);
    else if (objects.length > 1)
      instance.setActiveObject(
        new ActiveSelection(objects, { canvas: instance }),
      );
    instance.requestRenderAll();
    setSelectedIds(ids);
    selected.current = ids;
    selectionSync.current = false;
  };
  const selectLayer = (id: string, append: boolean) => {
    const element = current.current.document.elements.find(
      (entry) => entry.id === id,
    );
    const ids =
      element?.groupId && !append
        ? current.current.document.elements
            .filter((entry) => entry.groupId === element.groupId)
            .map((entry) => entry.id)
        : [id];
    syncSelection(
      append
        ? selected.current.includes(id)
          ? selected.current.filter((entry) => entry !== id)
          : [...selected.current, id]
        : ids,
    );
  };
  const removeSelected = () => {
    const value = current.current.document;
    commit({
      ...value,
      elements: value.elements.filter(
        (element) => !selected.current.includes(element.id) || element.locked,
      ),
    });
    syncSelection([]);
  };
  const duplicate = () => {
    const value = current.current.document,
      groupIds = new Map<string, string>();
    const copies = value.elements
      .filter(
        (element) => selected.current.includes(element.id) && !element.locked,
      )
      .map((element) => {
        if (element.groupId && !groupIds.has(element.groupId))
          groupIds.set(element.groupId, crypto.randomUUID());
        return {
          ...element,
          id: crypto.randomUUID(),
          x: element.x + 24,
          y: element.y + 24,
          groupId: element.groupId ? groupIds.get(element.groupId) : undefined,
        };
      });
    commit({ ...value, elements: [...value.elements, ...copies] });
    selected.current = copies.map((element) => element.id);
    setSelectedIds(selected.current);
  };
  const add = (element: PosterElement) => {
    commit({
      ...current.current.document,
      elements: [...current.current.document.elements, element],
    });
    selected.current = [element.id];
    setSelectedIds([element.id]);
    setRightTab("properties");
    setRightOpen(true);
    setTool("select");
  };
  const addText = (style: "heading" | "subtitle" | "body" | "badge") => {
    const value = current.current.document,
      size =
        style === "heading"
          ? Math.min(value.width * 0.13, value.height * 0.18)
          : style === "subtitle"
            ? 48
            : 32;
    add({
      id: crypto.randomUUID(),
      name: t(`poster.design.textStyles.${style}`),
      type: "text",
      text: t(`poster.design.textStyles.${style}`),
      x: value.width * 0.12,
      y: value.height * 0.35,
      width: value.width * 0.76,
      height: size * 1.5,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: style === "badge" ? "#ffffff" : "#07130b",
      fontSize: Math.round(size),
      fontFamily: zh
        ? style === "heading"
          ? "思源黑体 Heavy"
          : "思源黑体"
        : "Inter",
      fontWeight: "normal",
      textAlign: "left",
      ...(style === "badge"
        ? {
            badge: {
              background: "#16a06e",
              padX: 0.6,
              padY: 0.35,
              radius: 0.5,
            },
          }
        : {}),
    });
  };
  const addShape = (shape: string) => {
    const value = current.current.document,
      width = value.width * 0.3,
      height = value.height * 0.15;
    const base = {
      id: crypto.randomUUID(),
      name: t(`poster.design.shapes.${shape}`),
      x: value.width * 0.35,
      y: value.height * 0.4,
      width,
      height,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#16a06e",
    };
    if (["rect", "pill", "ellipse"].includes(shape))
      add({
        ...base,
        type: shape === "ellipse" ? "ellipse" : "rect",
        radius: shape === "pill" ? height / 2 : 0,
      });
    else {
      const paths: Record<string, string> = {
        line: "M 0 0 L 200 0",
        arrow: "M 0 120 L 150 0 M 85 0 L 150 0 L 150 65",
        star: "M 100 0 L 124 70 L 200 72 L 140 118 L 160 192 L 100 148 L 40 192 L 60 118 L 0 72 L 76 70 Z",
        sparkle:
          "M 100 0 Q 100 100 200 100 Q 100 100 100 200 Q 100 100 0 100 Q 100 100 100 0 Z",
      };
      add({
        ...base,
        type: "path",
        path: paths[shape] ?? paths.star,
        height: shape === "line" ? 1 : width,
        ...(shape === "line" || shape === "arrow"
          ? { fill: "rgba(0,0,0,0)", stroke: "#16a06e", strokeWidth: 8 }
          : {}),
      });
    }
  };
  const align = (direction: PosterAlign) => {
    const value = current.current.document,
      chosen = value.elements.filter(
        (element) => selected.current.includes(element.id) && !element.locked,
      );
    if (!chosen.length) return;
    const bounds =
      chosen.length === 1
        ? { left: 0, right: value.width, top: 0, bottom: value.height }
        : {
            left: Math.min(...chosen.map((element) => element.x)),
            right: Math.max(
              ...chosen.map((element) => element.x + element.width),
            ),
            top: Math.min(...chosen.map((element) => element.y)),
            bottom: Math.max(
              ...chosen.map((element) => element.y + element.height),
            ),
          };
    commit({
      ...value,
      elements: value.elements.map((element) =>
        !chosen.includes(element)
          ? element
          : {
              ...element,
              ...(direction === "left"
                ? { x: bounds.left }
                : direction === "right"
                  ? { x: bounds.right - element.width }
                  : direction === "center"
                    ? { x: (bounds.left + bounds.right - element.width) / 2 }
                    : direction === "top"
                      ? { y: bounds.top }
                      : direction === "bottom"
                        ? { y: bounds.bottom - element.height }
                        : {
                            y:
                              (bounds.top + bounds.bottom - element.height) / 2,
                          }),
            },
      ),
    });
  };
  const group = (ungroup: boolean) => {
    patchIds(selected.current, {
      groupId: ungroup ? undefined : crypto.randomUUID(),
    });
  };
  const moveLayer = (front: boolean, oneStep = false) => {
    const value = current.current.document,
      selectedElements = value.elements.filter(
        (element) => selected.current.includes(element.id) && !element.locked,
      ),
      rest = value.elements.filter(
        (element) => !selectedElements.includes(element),
      );
    if (!selectedElements.length) return;
    if (oneStep && selectedElements.length === 1) {
      const index = value.elements.indexOf(selectedElements[0]);
      rest.splice(
        Math.max(0, Math.min(rest.length, index + (front ? 1 : -1))),
        0,
        selectedElements[0],
      );
    } else if (front) rest.push(...selectedElements);
    else rest.unshift(...selectedElements);
    commit({ ...value, elements: rest });
  };
  actions.current = { commit, add };
  useEffect(() => {
    if (!initial || readOnly) return;
    let cancelled = false;
    if (requiresLocalEditSession(memo)) {
      session.current = createLocalEditSession(memo);
      setReady(true);
    } else
      void api
        .createMemoEditSession(memo.id)
        .then(({ editSession }) => {
          if (!cancelled) {
            session.current = editSession;
            setReady(true);
          }
        })
        .catch(() => {
          if (!cancelled) setError(t("poster.error"));
        });
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const stored = JSON.parse(raw);
        const document = PosterDocumentSchema.parse(stored.document);
        if (
          typeof stored.title === "string" &&
          typeof stored.baseHash === "string" &&
          (snapshot(stored.title, document) !==
            snapshot(memo.title ?? "", initial) ||
            (typeof stored.tagsText === "string" && stored.tagsText !== memo.tags.join(", ")))
        )
          setRecovery({ ...stored, document });
      }
    } catch {
      setError(t("poster.recoveryError"));
    }
    return () => {
      cancelled = true;
    };
  }, [memo.id, readOnly]);

  useEffect(() => {
    const update = classifyPosterUpdate(memo, currentMemo.current, dirty, Boolean(saveLock.current), previousSaveBase.current);
    if (update === "defer" || update === "ignore") return;
    if (update === "rebase") {
      // Advance optimistic checks while retaining any newer local edits.
      currentMemo.current = memo;
      return;
    }
    if (update === "conflict") {
      setError(t("poster.remoteChanged"));
      return;
    }
    const next = parsePosterDocument(memo.contentMarkdown);
    if (!next) {
      setError(t("poster.invalid"));
      return;
    }
    if (
      snapshot(memo.title ?? "", next) ===
      snapshot(current.current.title, current.current.document)
    ) {
      currentMemo.current = memo;
      setTagsText(memo.tags.join(", "));
      setSavedTags(memo.tags.join(", "));
      setSaved(snapshot(memo.title ?? "", next));
      return;
    }
    currentMemo.current = memo;
    setTagsText(memo.tags.join(", "));
    setSavedTags(memo.tags.join(", "));
    loadedArt.current = next.previewResourceId ? artwork(next) : "";
    setDocument(next);
    setCanvasRevision((version) => version + 1);
    setTitle(memo.title ?? "");
    setSaved(next.previewResourceId ? snapshot(memo.title ?? "", next) : "");
    undo.current = [];
    redo.current = [];
    setHistoryVersion((version) => version + 1);
  }, [memo.contentHash, memo.revision, saving]);

  useEffect(() => {
    const host = workbenchHost.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width < 760) setLeftOpen(false);
      if (entry.contentRect.width < 1000) setRightOpen(false);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!canvasHost.current) return;
    // Fabric owns this subtree. React must not manage a canvas that Fabric wraps and moves.
    const node = window.document.createElement("canvas");
    node.setAttribute("aria-label", t("poster.canvas"));
    canvasHost.current.appendChild(node);
    const instance = new Canvas(node, {
      preserveObjectStacking: true,
      selection: true,
      selectionKey: ["shiftKey", "ctrlKey", "metaKey"],
    });
    canvas.current = instance;
    const pick = () => {
      if (selectionSync.current) return;
      const ids = instance
        .getActiveObjects()
        .map(
          (object) =>
            current.current.document.elements[
              objectsRef.current.indexOf(object)
            ]?.id,
        )
        .filter((id): id is string => Boolean(id));
      if (ids.length === 1) {
        const groupId = current.current.document.elements.find(
          (element) => element.id === ids[0],
        )?.groupId;
        if (groupId) {
          syncSelection(
            current.current.document.elements
              .filter(
                (element) => element.groupId === groupId && !element.locked,
              )
              .map((element) => element.id),
          );
          setRightTab("properties");
          return;
        }
      }
      selected.current = ids;
      setSelectedIds(ids);
      if (ids.length) setRightTab("properties");
    };
    instance.on("selection:created", pick);
    instance.on("selection:updated", pick);
    instance.on("selection:cleared", pick);
    const changed = () => {
      if (options.current.readOnly) return;
      const value = current.current.document;
      const elements = value.elements.map((element, index) =>
        objectsRef.current[index]
          ? posterElementFromObject(element, objectsRef.current[index])
          : element,
      );
      const copy = { ...posterCopy(value) };
      for (const role of ["title", "subtitle", "badge"] as const)
        if (
          elements.some(
            (element, index) =>
              element.type === "text" &&
              element.role === role &&
              value.elements[index]?.type === "text" &&
              element.text !==
                (
                  value.elements[index] as Extract<
                    PosterElement,
                    { type: "text" }
                  >
                ).text,
          )
        )
          copy[role] = elements
            .filter(
              (element) => element.type === "text" && element.role === role,
            )
            .map((element) =>
              element.type === "text"
                ? (element.sourceText ?? element.text)
                : "",
            )
            .join("\n");
      actions.current.commit({ ...value, elements, copy }, false);
    };
    instance.on("object:modified", changed);
    instance.on("text:editing:exited", changed);
    instance.on("object:moving", ({ target }) => {
      if (!target || !options.current.snap || target instanceof ActiveSelection)
        return;
      const value = current.current.document,
        threshold = 6 / options.current.zoom;
      const bounds = target.getBoundingRect(),
        axes = {
          x: [0, value.width / 2, value.width],
          y: [0, value.height / 2, value.height],
        };
      for (const object of objectsRef.current)
        if (object !== target && object.visible) {
          const other = object.getBoundingRect();
          axes.x.push(
            other.left,
            other.left + other.width / 2,
            other.left + other.width,
          );
          axes.y.push(
            other.top,
            other.top + other.height / 2,
            other.top + other.height,
          );
        }
      const found: { x?: number; y?: number } = {};
      for (const axis of ["x", "y"] as const) {
        const start = axis === "x" ? bounds.left : bounds.top,
          size = axis === "x" ? bounds.width : bounds.height;
        let best = threshold,
          delta = 0;
        for (const anchor of [start, start + size / 2, start + size])
          for (const guide of axes[axis])
            if (Math.abs(guide - anchor) < best) {
              best = Math.abs(guide - anchor);
              found[axis] = guide;
              delta = guide - anchor;
            }
        if (found[axis] !== undefined)
          target.set(
            axis === "x" ? "left" : "top",
            (axis === "x" ? target.left : target.top) + delta,
          );
      }
      setGuides(found);
    });
    instance.on("mouse:up", () => setGuides({}));
    instance.on("path:created", ({ path }) => {
      const element = posterPrimitiveFromObject(path, 0);
      if (!element) return;
      actions.current.add({
        ...element,
        id: crypto.randomUUID(),
        name: t("poster.design.drawing"),
      });
      setTool("draw");
      syncSelection([]);
    });
    return () => {
      canvas.current = null;
      const wrapper = instance.wrapperEl;
      void instance.dispose().then(() => {
        node.remove();
        wrapper.remove();
      });
    };
  }, []);
  useEffect(() => {
    const instance = canvas.current;
    if (!instance) return;
    let cancelled = false;
    setCanvasReady(false);
    const value = current.current.document,
      ids = [...selected.current];
    void Promise.all(
      value.elements.map((element) => posterObject(element, readResource)),
    )
      .then((objects) => {
        if (cancelled) return;
        instance.discardActiveObject();
        instance.clear();
        instance.backgroundColor = value.backgroundGradient
          ? makePosterGradient(
              value.backgroundGradient,
              value.width,
              value.height,
            )
          : value.background;
        objectsRef.current = objects;
        for (let index = 0; index < objects.length; index++) {
          const element = value.elements[index],
            object = objects[index];
          object.set({
            selectable:
              !readOnly && !element.locked && element.visible !== false,
            evented: !readOnly && !element.locked && element.visible !== false,
            hasControls: !readOnly && !element.locked,
            lockMovementX: Boolean(element.locked),
            lockMovementY: Boolean(element.locked),
          });
          if (object instanceof Textbox)
            object.editable = !readOnly && !element.locked;
          instance.add(object);
        }
        syncSelection(
          ids.filter((id) =>
            value.elements.some(
              (element) => element.id === id && !element.locked,
            ),
          ),
        );
        instance.requestRenderAll();
        setCanvasReady(true);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : t("poster.error"),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [canvasRevision, readOnly, readResource]);
  useEffect(() => {
    const instance = canvas.current;
    if (!instance) return;
    instance.setDimensions({
      width: document.width * zoom,
      height: document.height * zoom,
    });
    instance.setViewportTransform([zoom, 0, 0, zoom, 0, 0]);
    instance.requestRenderAll();
  }, [zoom, document.width, document.height, canvasReady]);
  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const fit = () => {
      const next = Math.max(
        0.1,
        Math.min(
          1,
          (host.clientWidth - 112) / document.width,
          (host.clientHeight - 112) / document.height,
        ),
      );
      setFitZoom(next);
      if (autoFit) setZoom(next);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    return () => observer.disconnect();
  }, [document.width, document.height, autoFit, leftOpen, rightOpen]);
  useEffect(() => {
    const instance = canvas.current;
    if (!instance) return;
    const hand = tool === "hand" || spaceHeld;
    instance.isDrawingMode = tool === "draw" && !readOnly && !busy;
    instance.selection = !hand && tool === "select" && !readOnly && !busy;
    instance.skipTargetFind = hand || readOnly || busy;
    instance.defaultCursor = hand ? "grab" : "default";
    instance.hoverCursor = hand ? "grab" : "move";
    if (instance.isDrawingMode) {
      const brush = new PencilBrush(instance);
      brush.color = brushColor;
      brush.width = brushWidth;
      instance.freeDrawingBrush = brush;
    }
  }, [tool, spaceHeld, readOnly, busy, brushColor, brushWidth, canvasReady]);
  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setAutoFit(false);
      setZoom((value) =>
        Math.max(0.1, Math.min(2, value * Math.exp(-event.deltaY * 0.002))),
      );
    };
    host.addEventListener("wheel", wheel, { passive: false });
    return () => host.removeEventListener("wheel", wheel);
  }, []);

  saveRef.current = () => {
    if (saveLock.current) return saveLock.current;
    const editing = canvas.current?.getActiveObject();
    if (
      editing &&
      "exitEditing" in editing &&
      typeof editing.exitEditing === "function"
    )
      editing.exitEditing();
    const data = { ...current.current };
    if (snapshot(data.title, data.document) === saved && data.tagsText === savedTags)
      return Promise.resolve(true);
    if (!session.current || !canvasReady || readOnly || !initial)
      return Promise.resolve(false);
    const operation = (async () => {
      setSaving(true);
      setError(null);
      try {
        const captured = snapshot(data.title, data.document);
        const preview =
          artwork(data.document) !== loadedArt.current ||
          !data.document.previewResourceId
            ? await renderPosterBlob(data.document, readResource, "png", true)
            : undefined;
        const saveBase = currentMemo.current;
        const result = await savePosterMemo(
          repository,
          saveBase,
          data.document,
          data.title,
          session.current!.id,
          preview,
          parseTagsText(data.tagsText),
        );
        previousSaveBase.current = saveBase;
        currentMemo.current = result.memo;
        loadedArt.current = artwork(data.document);
        setSaved(captured);
        setSavedTags(data.tagsText);
        setDocument((latest) => ({
          ...latest,
          previewResourceId: result.document.previewResourceId,
        }));
        try {
          if (
            snapshot(current.current.title, current.current.document) ===
            captured && current.current.tagsText === data.tagsText
          )
            localStorage.removeItem(draftKey);
        } catch {
          /* Saved data remains in the repository. */
        }
        await onSavedRef.current(result.memo);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("poster.error"));
        return false;
      } finally {
        setSaving(false);
        saveLock.current = null;
      }
    })();
    saveLock.current = operation;
    return operation;
  };
  useEffect(() => {
    if (!dirty || readOnly || !initial) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          title,
          document,
          tagsText,
          baseHash: currentMemo.current.contentHash,
          baseContent: posterMemoContent(currentMemo.current),
        }),
      );
    } catch {
      setError(t("poster.recoveryError"));
    }
    if (!ready || !canvasReady || saving || busy || recovery || error) return;
    const timer = window.setTimeout(() => void saveRef.current(), 2000);
    return () => window.clearTimeout(timer);
  }, [
    title,
    document,
    tagsText,
    dirty,
    ready,
    canvasReady,
    saving,
    busy,
    recovery,
    error,
  ]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof z.ZodError || caught instanceof SyntaxError
          ? t("poster.aiInvalid")
          : caught instanceof Error
            ? caught.message
            : t("poster.error"),
      );
    } finally {
      setBusy(false);
    }
  };
  const exportImage = (format: "png" | "jpeg" | "webp") =>
    run(async () => {
      const editing = canvas.current?.getActiveObject();
      if (
        editing &&
        "exitEditing" in editing &&
        typeof editing.exitEditing === "function"
      )
        editing.exitEditing();
      const blob = await renderPosterBlob(
        current.current.document,
        readResource,
        format,
        false,
        exportScale,
        exportQuality,
      );
      downloadBlob(
        blob,
        `${title.trim().replace(/[\\/:*?"<>|]/g, "_") || "poster"}.${format === "jpeg" ? "jpg" : format}`,
      );
    });
  const insertInSource = () =>
    run(async () => {
      const sourceId = document.sourceMemoId;
      if (!sourceId) return;
      if (!navigator.onLine) throw new Error(t("poster.offline"));
      if (!(await saveRef.current())) return;
      const { memo: source } = await repository.getMemo(sourceId);
      if (
        source.isDeleted ||
        /<!--\s*edgeever-(?:poster|diagram|table|infographic)-v1:/.test(
          source.contentMarkdown,
        )
      )
        throw new Error(t("poster.sourceUnavailable"));
      const blob = await renderPosterBlob(
        current.current.document,
        readResource,
      );
      const { resource } = await repository.uploadMemoResource(
        source.id,
        new File([blob], "poster.png", { type: "image/png" }),
      );
      let inserted = false;
      try {
        const sourceSession = requiresLocalEditSession(source)
          ? createLocalEditSession(source)
          : (await api.createMemoEditSession(source.id)).editSession;
        const markdown = `${source.contentMarkdown}\n\n![${title.replace(/[\[\]\\\n]/g, " ")}](${resource.url})`;
        const result = await repository.updateMemo(source, {
          expectedRevision: source.revision,
          expectedContentHash: source.contentHash,
          editSessionId: sourceSession.id,
          contentMarkdown: markdown,
          contentJson: {
            ...source.contentJson,
            content: [
              ...(source.contentJson.content ?? []),
              { type: "image", attrs: { src: resource.url, alt: title } },
            ],
          },
          title: source.title ?? "",
          tags: source.tags,
        });
        inserted = true;
        await onSavedRef.current(result.memo);
        onOpenCompanionNote?.(source.id, source.notebookId);
      } finally {
        if (!inserted) {
          const latest = await repository.getMemo(source.id).catch(() => null);
          if (
            latest &&
            !JSON.stringify(latest.memo.contentJson).includes(resource.id) &&
            !latest.memo.contentMarkdown.includes(resource.id)
          )
            await repository.deleteResource(resource.id).catch(() => undefined);
        }
      }
    });
  const designAt = async (
    id: string,
    width = current.current.document.width,
    height = current.current.document.height,
    platformId = current.current.document.platformId,
  ) => {
    const editing = canvas.current?.getActiveObject();
    if (editing instanceof Textbox && editing.isEditing) editing.exitEditing();
    const value = current.current.document;
    const built = await buildPosterDesign({
      id,
      ...posterCopy(value),
      width,
      height,
      zh,
    });
    const extras = value.elements.filter(
      (element) =>
        !element.id.startsWith("design_") &&
        !["heading", "subtitle", "accent"].includes(element.id),
    );
    const scaled = resizePosterDocument(
      { ...value, elements: extras },
      width,
      height,
    ).elements;
    return {
      ...built,
      sourceMemoId: value.sourceMemoId,
      platformId,
      elements: [...built.elements, ...scaled],
    };
  };
  const applyTemplate = (id: string) =>
    run(async () => {
      const next = await designAt(id);
      syncSelection([]);
      commit(next);
      setAutoFit(true);
    });
  const resize = (width: number, height: number, platformId?: string) =>
    run(async () => {
      const value = current.current.document;
      const next = value.templateId
        ? await designAt(value.templateId, width, height, platformId)
        : { ...resizePosterDocument(value, width, height), platformId };
      syncSelection([]);
      commit(next);
      setExportScale((scale) =>
        Math.min(scale, Math.floor(8192 / Math.max(width, height))),
      );
      setAutoFit(true);
    });
  const changePlatform = (id: string) => {
    const platform = PLATFORMS.find((entry) => entry.id === id);
    if (platform) void resize(platform.width, platform.height, id);
  };
  const upload = (file: File) =>
    run(async () => {
      if (
        file.size > 10 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new Error(t("poster.imageLimit"));
      if (!navigator.onLine) throw new Error(t("poster.offline"));
      if (current.current.document.elements.length >= 500)
        throw new Error(t("poster.invalid"));
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width,
        height = bitmap.height;
      bitmap.close();
      if (width * height > 36_000_000) throw new Error(t("poster.imageLimit"));
      const compressed = await compressImageForUpload(file);
      const { resource } = await repository.uploadMemoResource(
        memo.id,
        compressed.file,
      );
      const value = current.current.document,
        factor = Math.min(
          (value.width * 0.7) / width,
          (value.height * 0.5) / height,
          1,
        );
      add({
        id: crypto.randomUUID(),
        name: file.name.slice(0, 120),
        type: "image",
        resourceId: resource.id,
        x: (value.width - width * factor) / 2,
        y: (value.height - height * factor) / 2,
        width: width * factor,
        height: height * factor,
        rotation: 0,
        opacity: 1,
        locked: false,
      });
    });
  const imageFit = (cover: boolean) =>
    run(async () => {
      if (active?.type !== "image") return;
      const bitmap = await createImageBitmap(
          await readResource(active.resourceId),
        ),
        ratio = bitmap.width / bitmap.height;
      bitmap.close();
      const value = current.current.document;
      if (cover) {
        const frame = value.width / value.height,
          width = frame < ratio ? frame / ratio : 1,
          height = frame > ratio ? ratio / frame : 1;
        commit({
          ...value,
          elements: [
            {
              ...active,
              x: 0,
              y: 0,
              width: value.width,
              height: value.height,
              rotation: 0,
              crop: { x: (1 - width) / 2, y: (1 - height) / 2, width, height },
            },
            ...value.elements.filter((element) => element.id !== active.id),
          ],
        });
      } else {
        const width = Math.min(value.width * 0.8, value.height * 0.8 * ratio),
          height = width / ratio;
        updateElement({
          x: (value.width - width) / 2,
          y: (value.height - height) / 2,
          width,
          height,
          crop: undefined,
          rotation: 0,
        });
      }
    });
  const copyImage = () =>
    run(async () => {
      const blob = await renderPosterBlob(
        current.current.document,
        readResource,
      );
      if (!(await copyImageBlobToClipboard(blob)))
        throw new Error(t("poster.design.copyFailed"));
      setToast(t("poster.design.copied"));
    });
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const input =
        event.target instanceof HTMLElement &&
        (event.target.closest("input,textarea,select,[contenteditable=true]") ||
          (canvas.current?.getActiveObject() instanceof Textbox &&
            (canvas.current.getActiveObject() as Textbox).isEditing));
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
        return;
      }
      if (input || !editable) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        travel(!event.shiftKey);
      } else if (command && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      } else if (command && event.key.toLowerCase() === "g") {
        event.preventDefault();
        group(event.shiftKey);
      } else if (command && event.key.toLowerCase() === "a") {
        event.preventDefault();
        syncSelection(
          current.current.document.elements
            .filter((element) => !element.locked && element.visible !== false)
            .map((element) => element.id),
        );
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      } else if (event.key === "Escape") {
        syncSelection([]);
        setTool("select");
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        selected.current.length
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1,
          value = current.current.document;
        commit({
          ...value,
          elements: value.elements.map((element) =>
            !selected.current.includes(element.id) || element.locked
              ? element
              : {
                  ...element,
                  x:
                    element.x +
                    (event.key === "ArrowLeft"
                      ? -step
                      : event.key === "ArrowRight"
                        ? step
                        : 0),
                  y:
                    element.y +
                    (event.key === "ArrowUp"
                      ? -step
                      : event.key === "ArrowDown"
                        ? step
                        : 0),
                },
          ),
        });
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [editable]);
  const toolButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
    active = false,
    text = false,
  ) => (
    <PosterTool
      label={label}
      onClick={onClick}
      disabled={disabled}
      active={active}
      text={text}
    >
      {icon}
    </PosterTool>
  );
  const safeMargin =
    Math.min(document.width, document.height) * (platform?.margin ?? 0.06);
  return (
    <div className="relative flex h-full min-h-0 min-w-0 bg-card" data-poster-workbench>
    <div ref={workbenchHost} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-card">
        <div className={MEMO_EDITOR_TOP_ROW_CLASS_NAME}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-4 sm:flex-nowrap">
            <MemoEditorTopRowLeading
              mobileBackButton={<IconTooltip label={t("poster.back")}><Button className="lg:hidden" variant="ghost" size="icon" aria-label={t("poster.back")} onClick={() => { void (async () => { if (!dirty || await saveRef.current()) onBackToList(); })(); }}><ArrowLeft className="h-4 w-4" /></Button></IconTooltip>}
              titleInput={<MemoTitleInput value={title} onValueChange={setTitle} readOnly={!editable} placeholder={t("poster.name")} ariaLabel={t("poster.title")} />}
            />
            <MemoEditorMetadataRow rowClassName={MEMO_EDITOR_METADATA_ROW_CLASS_NAME} contentMarkdown={memo.contentMarkdown} disabled={!editable}
              mobileNotebookPickerOpen={mobileNotebookPickerOpen} notebookOptions={notebookOptions} notebookUpdatePending={notebookUpdatePending || saving}
              repository={repository} selectedNotebookId={currentMemo.current.notebookId} tagsText={tagsText} title={title}
              onMobileNotebookPickerOpenChange={setMobileNotebookPickerOpen} onTagsChange={setTagsText}
              onNotebookChange={(notebookId) => {
                if (!editable || notebookUpdatePending || notebookId === currentMemo.current.notebookId) return;
                setNotebookUpdatePending(true);
                void (async () => {
                  if (!(await saveRef.current())) return;
                  await repository.moveMemos({ memoIds: [memo.id], notebookId });
                  const result = await repository.getMemo(memo.id);
                  currentMemo.current = result.memo;
                  await onSaved(result.memo);
                })().catch((caught) => setError(caught instanceof Error ? caught.message : t("poster.error"))).finally(() => { setNotebookUpdatePending(false); setMobileNotebookPickerOpen(false); });
              }} />
          </div>
          <div className="flex shrink-0 items-center gap-1 pr-2">
            <span role="status" className="hidden text-xs text-slate-500 sm:inline-flex">{t(readOnly ? "poster.readOnly" : saving ? "poster.saving" : dirty ? "poster.unsaved" : "poster.saved")}</span>
            {onToggleDesktopFocusMode && <MemoEditorFocusModeButton desktopFocusMode={desktopFocusMode} onToggleDesktopFocusMode={onToggleDesktopFocusMode} />}
            {onOpenExecutionCenter && <MemoEditorHeaderActions onOpenExecutionCenter={onOpenExecutionCenter} moreMenuItems={<DropdownMenuItem disabled={!canvasReady || busy || !initial} onClick={() => setExportOpen(true)}>{t("poster.design.export")}</DropdownMenuItem>} />}
          </div>
        </div>
        <div className="flex min-h-9 items-center justify-end gap-2 overflow-x-auto px-4 py-0.5">
        {!initial && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadBlob(
                new Blob([memo.contentMarkdown], { type: "text/markdown" }),
                "poster-source.md",
              )
            }
          >
            {t("poster.design.downloadSource")}
          </Button>
        )}
        {toast && (
          <span role="status" className="text-xs text-emerald-600">
            {toast}
          </span>
        )}
        {document.sourceMemoId && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!editable || saving}
            onClick={() => void insertInSource()}
          >
            {t("poster.insertSource")}
          </Button>
        )}
        {toolButton(
          t("poster.save"),
          saving ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          ),
          () => {
            void saveRef.current();
          },
          !editable || saving,
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!canvasReady || busy || !initial}
          onClick={() => void copyImage()}
        >
          <Copy className="h-3.5 w-3.5" />
          {t("poster.design.copyImage")}
        </Button>
        <Button
          size="sm"
          disabled={!canvasReady || busy || !initial}
          onClick={() => setExportOpen(true)}
        >
          <Download className="h-3.5 w-3.5" />
          {t("poster.design.export")}
        </Button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900"
        >
          <span className="flex-1">{error}</span>
          {toolButton(
            t("poster.retry"),
            <Redo2 className="h-3.5 w-3.5" />,
            () => {
              setError(null);
              setCanvasRevision((value) => value + 1);
            },
          )}
        </div>
      )}
      {recovery && (
        <div className="flex items-center gap-3 border-b bg-amber-50 px-4 py-2 text-xs">
          <span className="flex-1">{t("poster.recover")}</span>
          <Button
            size="sm"
            onClick={() => {
              if (!canRestorePosterDraft(recovery, currentMemo.current)) {
                setError(t("poster.remoteChanged"));
                return;
              }
              commit(recovery.document);
              setTitle(recovery.title);
              if (typeof recovery.tagsText === "string") setTagsText(recovery.tagsText);
              setRecovery(null);
            }}
          >
            {t("poster.restore")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              downloadBlob(
                new Blob([JSON.stringify(recovery)], {
                  type: "application/json",
                }),
                "poster-draft.json",
              );
            }}
          >
            {t("poster.downloadDraft")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRecovery(null);
            }}
          >
            {t("poster.later")}
          </Button>
        </div>
      )}
      <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-3">
        {toolButton(
          t("poster.design.templates"),
          <PanelLeftClose className="h-4 w-4" />,
          () => setLeftOpen(!leftOpen),
          false,
          leftOpen,
        )}
        <div className="mx-1 h-5 border-l" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-32 justify-between text-xs"
            >
              {platform
                ? zh
                  ? platform.zh
                  : platform.en
                : `${document.width} × ${document.height}`}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {PLATFORMS.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                disabled={!editable}
                onSelect={() => changePlatform(entry.id)}
              >
                {zh ? entry.zh : entry.en}
                <span className="ml-auto pl-4 text-[10px] text-slate-400">
                  {entry.width}×{entry.height}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setRightTab("canvas");
                setRightOpen(true);
              }}
            >
              {t("poster.design.customSize")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="shrink-0 gap-1 tabular-nums" aria-label={t("poster.design.zoom")}>
                {Math.round(zoom * 100)}%
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              {document.width} × {document.height} px
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => { setAutoFit(true); setZoom(fitZoom); }}>
              {t("poster.design.fit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { setAutoFit(false); setZoom(Math.max(0.1, zoom / 1.2)); }}>
              {t("poster.design.zoomOut")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { setAutoFit(false); setZoom(Math.min(2, zoom * 1.2)); }}>
              {t("poster.design.zoomIn")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {[0.25, 0.5, 0.75, 1, 1.5, 2].map((value) => (
              <DropdownMenuItem key={value} onSelect={() => { setAutoFit(false); setZoom(value); }}>
                {value * 100}%
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <p className="max-w-60 px-2 py-1.5 text-xs text-muted-foreground">
              {t(selectedIds.length ? "poster.design.selectionCount" : "poster.design.canvasHint", { count: selectedIds.length })}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="mx-1 h-5 border-l" />
        {toolButton(
          t("poster.text"),
          <Type className="h-4 w-4" />,
          () => addText("heading"),
          !editable,
          false,
          true,
        )}
        {toolButton(
          t("poster.design.shape"),
          <Shapes className="h-4 w-4" />,
          () => {
            setLeftTab("assets");
            setLeftOpen(true);
          },
          !editable,
          false,
          true,
        )}
        {toolButton(
          t("poster.image"),
          <ImagePlus className="h-4 w-4" />,
          () => fileInput.current?.click(),
          !editable,
          false,
          true,
        )}
        <div className="mx-1 h-5 border-l" />
        {toolButton(
          t("poster.design.select"),
          <MousePointer2 className="h-4 w-4" />,
          () => setTool("select"),
          !editable,
          tool === "select",
        )}
        {toolButton(
          t("poster.design.pan"),
          <Hand className="h-4 w-4" />,
          () => setTool("hand"),
          false,
          tool === "hand",
        )}
        {toolButton(
          t("poster.design.draw"),
          <Pencil className="h-4 w-4" />,
          () => setTool("draw"),
          !editable,
          tool === "draw",
        )}
        {tool === "draw" && (
          <>
            <input
              type="color"
              aria-label={t("poster.color")}
              value={brushColor}
              onChange={(event) => setBrushColor(event.target.value)}
              className="h-6 w-7"
            />
            <input
              type="range"
              aria-label={t("poster.design.strokeWidth")}
              min="1"
              max="80"
              value={brushWidth}
              onChange={(event) => setBrushWidth(Number(event.target.value))}
              className="w-20"
            />
          </>
        )}
        <div className="mx-1 h-5 border-l" />
        {toolButton(
          t("poster.undo"),
          <Undo2 className="h-4 w-4" />,
          () => travel(true),
          !editable || !undo.current.length,
        )}
        {toolButton(
          t("poster.redo"),
          <Redo2 className="h-4 w-4" />,
          () => travel(false),
          !editable || !redo.current.length,
        )}
        <div className="flex-1" />
        {toolButton(
          t("poster.design.grid"),
          <Grid3X3 className="h-4 w-4" />,
          () => setGrid(!grid),
          false,
          grid,
        )}
        {toolButton(
          t("poster.design.snap"),
          <ScanLine className="h-4 w-4" />,
          () => setSnap(!snap),
          false,
          snap,
        )}
        {toolButton(
          t("poster.design.safeArea"),
          <RectangleHorizontal className="h-4 w-4" />,
          () => setSafeArea(!safeArea),
          false,
          safeArea,
        )}
        {toolButton(
          t("poster.properties"),
          <PanelRightClose className="h-4 w-4" />,
          () => setRightOpen(!rightOpen),
          false,
          rightOpen,
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && editable) void upload(file);
        }}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {leftOpen && (
          <aside className="flex w-[252px] shrink-0 flex-col border-r bg-card">
            <div className="grid h-11 shrink-0 grid-cols-2 border-b px-2 text-xs">
              {(["templates", "assets"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`border-b-2 ${leftTab === tab ? "border-emerald-600 font-semibold text-emerald-700" : "border-transparent text-slate-500"}`}
                  onClick={() => setLeftTab(tab)}
                >
                  {t(`poster.design.${tab}`)}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {leftTab === "templates" ? (
                <PosterTemplatePanel
                  width={document.width}
                  height={document.height}
                  platformId={platform?.id}
                  templateId={document.templateId}
                  zh={zh}
                  disabled={!editable}
                  onApply={(id) => void applyTemplate(id)}
                />
              ) : (
                <PosterAssetsPanel
                  repository={repository}
                  disabled={!editable}
                  onUpload={() => fileInput.current?.click()}
                  onResource={(resource) => {
                    void readResource(resource.id)
                      .then((blob) =>
                        upload(
                          new File([blob], resource.filename ?? "image.png", {
                            type: resource.mimeType ?? blob.type,
                          }),
                        ),
                      )
                      .catch((error) => setError(String(error)));
                  }}
                  onText={addText}
                  onShape={addShape}
                />
              )}
            </div>
          </aside>
        )}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={viewport}
              className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-[#eef0f3]"
              data-poster-canvas
              style={{
                backgroundImage:
                  "radial-gradient(#c7cdd5 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }}
              onDragOver={(event) => {
                if (editable) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file && editable) void upload(file);
              }}
              onPaste={(event) => {
                const file = [...event.clipboardData.files].find((file) =>
                  file.type.startsWith("image/"),
                );
                if (file && editable) {
                  event.preventDefault();
                  void upload(file);
                }
              }}
              onPointerDownCapture={(event) => {
                if (
                  (tool === "hand" || spaceHeld || event.button === 1) &&
                  viewport.current
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  panStart.current = {
                    x: event.clientX,
                    y: event.clientY,
                    left: viewport.current.scrollLeft,
                    top: viewport.current.scrollTop,
                  };
                  viewport.current.setPointerCapture(event.pointerId);
                }
              }}
              onPointerMove={(event) => {
                if (panStart.current && viewport.current) {
                  viewport.current.scrollLeft =
                    panStart.current.left - event.clientX + panStart.current.x;
                  viewport.current.scrollTop =
                    panStart.current.top - event.clientY + panStart.current.y;
                }
              }}
              onPointerUp={() => {
                panStart.current = null;
              }}
              onPointerCancel={() => {
                panStart.current = null;
              }}
            >
              <div
                className="flex min-h-full min-w-full items-center justify-center p-14"
                style={{
                  width: document.width * zoom + 112,
                  height: document.height * zoom + 112,
                }}
              >
                <div
                  className="relative shrink-0 shadow-[0_8px_32px_rgba(15,23,42,0.14)]"
                  style={{
                    width: document.width * zoom,
                    height: document.height * zoom,
                  }}
                >
                  <div ref={canvasHost} />
                  {grid && (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        backgroundImage:
                          "linear-gradient(to right,#16a06e22 1px,transparent 1px),linear-gradient(to bottom,#16a06e22 1px,transparent 1px)",
                        backgroundSize: `${(document.width * zoom) / 12}px ${(document.width * zoom) / 12}px`,
                      }}
                    />
                  )}
                  {safeArea && (
                    <div
                      className="pointer-events-none absolute border border-dashed border-rose-500/70"
                      style={{
                        left: safeMargin * zoom,
                        top: safeMargin * zoom,
                        right: safeMargin * zoom,
                        bottom: safeMargin * zoom,
                      }}
                    />
                  )}
                  {safeArea &&
                    platform?.avoid.map((zone, index) => (
                      <div
                        key={index}
                        className="pointer-events-none absolute border border-dashed border-rose-500/60 bg-rose-500/10 text-[9px] text-rose-600"
                        style={{
                          left: zone.x * document.width * zoom,
                          top: zone.y * document.height * zoom,
                          width: zone.w * document.width * zoom,
                          height: zone.h * document.height * zoom,
                        }}
                      >
                        {zh ? zone.zh : zone.en}
                      </div>
                    ))}
                  {guides.x !== undefined && (
                    <div
                      className="pointer-events-none absolute inset-y-0 border-l border-fuchsia-500"
                      style={{ left: guides.x * zoom }}
                    />
                  )}
                  {guides.y !== undefined && (
                    <div
                      className="pointer-events-none absolute inset-x-0 border-t border-fuchsia-500"
                      style={{ top: guides.y * zoom }}
                    />
                  )}
                </div>
              </div>
              {!canvasReady && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <LoaderCircle className="h-7 w-7 animate-spin text-emerald-600" />
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!editable || !selectedIds.length}
              onSelect={duplicate}
            >
              {t("poster.design.duplicate")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!editable || selectedIds.length < 2}
              onSelect={() => group(false)}
            >
              {t("poster.design.group")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!editable || !selectedIds.length}
              onSelect={() => group(true)}
            >
              {t("poster.design.ungroup")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!editable || !selectedIds.length}
              onSelect={() => moveLayer(true)}
            >
              {t("poster.front")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!editable || !selectedIds.length}
              onSelect={() => moveLayer(false)}
            >
              {t("poster.backLayer")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!editable || !selectedIds.length}
              onSelect={removeSelected}
            >
              {t("poster.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {rightOpen && (
          <aside className="flex w-[280px] shrink-0 flex-col border-l bg-card">
            <div className="grid h-11 shrink-0 grid-cols-2 border-b px-2 text-xs">
              {(["properties", "layers", "canvas"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`border-b-2 ${rightTab === tab ? "border-emerald-600 font-semibold text-emerald-700" : "border-transparent text-slate-500"}`}
                  onClick={() => setRightTab(tab)}
                >
                  {tab === "canvas"
                    ? t("poster.design.canvasTab")
                    : t(`poster.${tab}`)}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rightTab === "properties" ? (
                <PosterInspector
                  elements={selectedElements}
                  disabled={!editable}
                  zh={zh}
                  onPatch={updateElement}
                  onAlign={align}
                  onDuplicate={duplicate}
                  onDelete={removeSelected}
                  onImageFit={(cover) => void imageFit(cover)}
                />
              ) : rightTab === "layers" ? (
                <PosterLayers
                  elements={document.elements}
                  selected={selectedIds}
                  disabled={!editable}
                  onSelect={selectLayer}
                  onChange={(id, patch) => patchIds([id], patch, true)}
                  onGroup={group}
                  onMove={moveLayer}
                />
              ) : (
                <PosterCanvasSettings
                  document={document}
                  disabled={!editable}
                  zh={zh}
                  onChange={commit}
                  onResize={(width, height) => void resize(width, height)}
                  onPlatform={changePlatform}
                />
              )}
            </div>
          </aside>
        )}
      </div>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("poster.design.export")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {(["png", "jpeg", "webp"] as const).map((format) => (
                <Button
                  key={format}
                  variant={exportFormat === format ? "solid" : "outline"}
                  onClick={() => setExportFormat(format)}
                >
                  {format.toUpperCase()}
                </Button>
              ))}
            </div>
            <label className="flex items-center justify-between text-sm">
              {t("poster.design.exportScale")}
              <select
                className="rounded border p-2"
                value={exportScale}
                onChange={(event) => setExportScale(Number(event.target.value))}
              >
                {[1, 2, 3]
                  .filter(
                    (scale) =>
                      Math.max(document.width, document.height) * scale <= 8192,
                  )
                  .map((scale) => (
                    <option key={scale} value={scale}>
                      {scale}×
                    </option>
                  ))}
              </select>
            </label>
            {exportFormat !== "png" && (
              <label className="flex items-center justify-between text-sm">
                {t("poster.design.exportQuality")}
                <input
                  type="range"
                  min=".5"
                  max="1"
                  step=".01"
                  value={exportQuality}
                  onChange={(event) =>
                    setExportQuality(Number(event.target.value))
                  }
                />
                <span>{Math.round(exportQuality * 100)}%</span>
              </label>
            )}
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              {Math.round(document.width * exportScale)} ×{" "}
              {Math.round(document.height * exportScale)} px
            </p>
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => void exportImage(exportFormat)}
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {t("poster.design.download")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {!readOnly && !aiAssistantOpen && <IconTooltip side="left" label={t("aiAssistant.open")}>
        <Button variant="outline" size="icon" data-ai-assistant-launcher="" aria-label={t("aiAssistant.open")}
          className={`${AI_ASSISTANT_LAUNCHER_POSITION} absolute z-30 size-11 rounded-full border-slate-200 bg-card text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.14)]`}
          onClick={() => setAiSidebarOpen(true)}><Sparkles className="size-5" strokeWidth={1.75} /></Button>
      </IconTooltip>}
    </div>
    <AiSidebarErrorBoundary open={aiAssistantOpen} onOpenChange={setAiSidebarOpen}>
      <AiSidebar open={aiAssistantOpen} onOpenChange={setAiSidebarOpen} companionAvailable={companionAvailable}
        contentMarkdown={`${posterFallbackMarkdown(document)}\n\nEditable poster canvas: ${document.width} × ${document.height}. Use get_poster and update_poster to edit elements; do not replace the note Markdown.`}
        selectionMarkdown={selectedIds.length ? `Selected poster element IDs: ${selectedIds.join(", ")}. Preserve elements outside this selection unless the user explicitly asks to change the whole poster.` : undefined}
        memoId={memo.id} notebookId={memo.notebookId} noteTitle={title}
        notebookTitle={notebookOptions.find((item) => item.id === memo.notebookId)?.name}
        beforeCompanionApply={async () => { if (!(await saveRef.current())) throw new Error("save failed"); await beforeCompanionApply?.(); }}
        onCompanionNotesChanged={onCompanionNotesChanged} onOpenCompanionNote={onOpenCompanionNote} />
    </AiSidebarErrorBoundary>
    </div>
  );
}
