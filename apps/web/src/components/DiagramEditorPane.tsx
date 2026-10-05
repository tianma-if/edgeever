import { diagramEditorSnapshot } from "@/lib/diagram-editor-snapshot";
import { focusArchitectureRelations } from "@/lib/architecture-relations";
import { MemoTitleInput } from "@/components/MemoTitleInput";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Dom, Export, Graph, History, Keyboard, Scroller, Selection, type Edge, type Node } from "@antv/x6";
import * as m from "motion/react-m";
import {
  Activity,
  AppWindow,
  ArrowDownUp,
  Binary,
  Blocks,
  Bot,
  Box,
  Boxes,
  Braces,
  BrainCircuit,
  BrickWall,
  Cable,
  Check,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  Circle,
  CircleAlert,
  Cloud,
  CloudCog,
  Code2,
  Compass,
  Container,
  Copy,
  Cpu,
  Diamond,
  Database,
  DatabaseZap,
  EthernetPort,
  ExternalLink,
  FileCode2,
  FileClock,
  FileImage,
  FileStack,
  FolderArchive,
  Gauge,
  GitBranch,
  GitFork,
  Globe2,
  Gpu,
  Grid2x2,
  HardDrive,
  History as HistoryIcon,
  KeyRound,
  ListOrdered,
  ListTree,
  LockKeyhole,
  LoaderCircle,
  MemoryStick,
  Microchip,
  MonitorSmartphone,
  Network,
  Pencil,
  PlugZap,
  Radio,
  RefreshCw,
  RotateCcw,
  Route,
  Router,
  Search,
  Server,
  ServerCog,
  Share2,
  ShieldCheck,
  ShieldEllipsis,
  ShipWheel,
  Smartphone,
  Sparkles,
  SquareFunction,
  Trash2,
  WavesHorizontal,
  Waypoints,
  Webhook,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ARCHITECTURE_DIAGRAM_SCHEMA_VERSION,
  ARCHITECTURE_EDGE_LABEL_FONT_SIZE,
  ARCHITECTURE_EDGE_LABEL_LINE_HEIGHT,
  DIAGRAM_SCHEMA_VERSION,
  diagramFallbackMarkdown,
  markdownToDoc,
  MIND_MAP_CONNECTOR_NAME,
  MIND_MAP_EDGE_LABEL_FONT_SIZE,
  MIND_MAP_EDGE_LABEL_LINE_HEIGHT,
  MIND_MAP_HORIZONTAL_GAP,
  mindMapTopicMarkup,
  MIND_MAP_VERTICAL_GAP,
  mindMapBranchSides,
  mindMapConnector,
  mindMapEdgeLineAttrs,
  mindMapEdgeTerminal,
  mindMapEdgeVisual,
  mindMapSiblingSpan,
  mindMapNodePresentation,
  mindMapNodeRole,
  resolveMindMapNodeStyle,
  parseDiagramDocument,
  resolveDiagramStructure,
  resolveDiagramTheme,
  resolveFlowchartTheme,
  serializeDiagramDocument,
  ARCHITECTURE_COMPONENT_SHAPES,
  ARCHITECTURE_LABEL_FONT,
  ARCHITECTURE_NODE_FONT_SIZE,
  ARCHITECTURE_NODE_FONT_WEIGHT,
  ARCHITECTURE_NODE_LINE_HEIGHT,
  ARCHITECTURE_SHAPE_RESOURCE,
  architectureEdgePorts,
  architectureEdgeTerminals,
  architectureEdgeRouter,
  architectureTerminalAnchor,
  architectureEdgeVisual,
  architectureIconOffset,
  architectureNodeVisual,
  isArchitectureNodeShape,
  resolveArchitectureSurface,
  diagramReaderFocusNode,
  FLOWCHART_EDGE_LABEL_FONT_SIZE,
  FLOWCHART_EDGE_LABEL_LINE_HEIGHT,
  FLOWCHART_EDGE_ROUTER,
  FLOWCHART_LABEL_FONT,
  flowchartEdgeIsStraight,
  flowchartEdgePorts,
  flowchartFitsReadableViewport,
  flowchartNodeVisual,
  resolveFlowchartSurface,
  type ArchitectureComponentShape,
  type ArchitectureResourceIcon,
  type DiagramDocument,
  type DiagramEdgeKind,
  type DiagramNodeShape,
  type DiagramStructure,
  type DiagramTheme,
  type MemoDetail,
  type MemoEditSession,
  type Notebook,
} from "@edgeever/shared";
import { AiSidebar, readAiSidebarOpen, writeAiSidebarOpen } from "@/components/ai-sidebar/AiSidebar";
import { AiSidebarErrorBoundary } from "@/components/ai-sidebar/AiSidebarErrorBoundary";
import { IconTooltip } from "@/components/editor/EditorPaneChrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import { RevisionHistoryDialog } from "@/components/dialogs/RevisionHistoryDialog";
import { ShareMemoDialog } from "@/components/dialogs/ShareMemoDialog";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import { DiagramToolbar, DiagramToolbarAddTrigger } from "@/components/DiagramToolbar";
import { MemoEditorHeaderActions } from "@/components/MemoEditorHeaderActions";
import { MemoEditorMetadataRow } from "@/components/MemoEditorMetadataRow";
import { MemoEditorFocusModeButton, MemoEditorTopRowLeading } from "@/components/MemoEditorTopRowLeading";
import { MemoEditorToolbarDivider } from "@/components/MemoEditorToolbarChrome";
import {
  MEMO_EDITOR_METADATA_ROW_CLASS_NAME,
  MEMO_EDITOR_TOP_ROW_CLASS_NAME,
  nextTitleStatusClearance,
} from "@/components/MemoEditorChromeDensity";
import { EditorNoteSearchBar } from "@/components/editor/EditorNoteSearchBar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppearanceTheme } from "@/components/ThemeProvider";
import { api } from "@/lib/api";
import { EDITOR_LOCAL_SAVE_DELAY_MS, formatShortcutBinding, getNotebookMoveOptions, type ShortcutSettings } from "@/lib/app-helpers";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  architectureNodeHeight,
  compactArchitectureNodeSize,
  compactFlowchartNodeSize,
  flowchartNodePresentation,
  computeDiagramLayout,
  computeDiagramLayoutResult,
  getDiagramLayoutViewport,
  type DiagramLayoutViewport,
} from "@/lib/diagram-layout";
import { applyDiagramScrollerFitOptions, diagramCanvasIsReady, isUsableDiagramBounds } from "@/lib/diagram-scroller-fit";
import { DIAGRAM_ZOOM_SCALE_MAX, DIAGRAM_ZOOM_SCALE_MIN } from "@/lib/diagram-zoom";
import { resolveDiagramPalette, type DiagramAppearance } from "@/lib/diagram-theme";
import { isLocalMemoId } from "@/lib/local-mirror";
import { isBrowserOffline } from "@/lib/network-status";
import { statusSettleMotion } from "@/lib/motion";
import type { EdgeEverRepository } from "@/lib/repository";
import { cn, parseTagsText } from "@/lib/utils";

Graph.registerConnector(MIND_MAP_CONNECTOR_NAME, mindMapConnector, true);

type DiagramEditorPaneProps = {
  memo: MemoDetail;
  notebooks: Notebook[];
  repository: EdgeEverRepository;
  readOnly: boolean;
  desktopFocusMode: boolean;
  onBackToList: () => void;
  onDeleted: (memoId: string) => Promise<void>;
  onPermanentDeleted: (memoId: string) => Promise<void>;
  onRestored: (memoId: string) => Promise<void>;
  onSaved: (memo: MemoDetail) => Promise<void>;
  onSaveAsTemplate: (memo: MemoDetail, name: string) => Promise<void>;
  onToggleDesktopFocusMode: () => void;
  onOpenExecutionCenter: () => void;
  aiAssistantOpenToken: number;
  shortcutSettings: ShortcutSettings;
  companionAvailable: boolean;
  beforeCompanionApply?: () => Promise<void>;
  onCompanionNotesChanged?: () => Promise<void>;
  onOpenCompanionNote?: (id: string, notebookId: string) => void;
};

type NodeData = { label: string; shape: DiagramNodeShape; parentId?: string; resourceIcon?: ArchitectureResourceIcon };
type EdgeData = { kind?: DiagramEdgeKind; bidirectional?: boolean };
type MindMapInsertRelation = "child" | "sibling";
type FlowPort = "top" | "right" | "bottom" | "left";
type FlowQuickCreateState = {
  draftEdgeId: string;
  restoreHistory: boolean;
  sourceNodeId: string;
  sourcePort?: FlowPort;
  x: number;
  y: number;
  left: number;
  top: number;
};
type FlowPointerDragState = {
  sourceNodeId: string;
  sourcePort: FlowPort;
  startClientX: number;
  startClientY: number;
};
type NodeEditorState = {
  nodeId: string;
  originalValue: string;
  value: string;
  shape: DiagramNodeShape;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  background: string;
  borderColor: string;
};

type ArchitectureLibraryItem = {
  icon: LucideIcon;
  labelKey: `diagram.architectureResources.${ArchitectureResourceIcon}`;
  shape: DiagramNodeShape;
};

const ARCHITECTURE_LIBRARY_DRAG_TYPE = "application/x-edgeever-architecture-resource";

const ARCHITECTURE_LIBRARY_CATEGORIES: Array<{
  id: string;
  labelKey: string;
  tone: string;
  items: ArchitectureLibraryItem[];
}> = [
  {
    id: "applications",
    labelKey: "diagram.componentCategoryExperience",
    tone: "text-cyan-600",
    items: [
      { shape: "client", icon: MonitorSmartphone, labelKey: "diagram.architectureResources.client" },
      { shape: "frontend", icon: AppWindow, labelKey: "diagram.architectureResources.webApp" },
      { shape: "client", icon: Smartphone, labelKey: "diagram.architectureResources.mobileApp" },
      { shape: "frontend", icon: Globe2, labelKey: "diagram.architectureResources.website" },
      { shape: "client", icon: Code2, labelKey: "diagram.architectureResources.apiClient" },
    ],
  },
  {
    id: "compute",
    labelKey: "diagram.componentCategoryServices",
    tone: "text-emerald-600",
    items: [
      { shape: "service", icon: Server, labelKey: "diagram.architectureResources.service" },
      { shape: "service", icon: Cpu, labelKey: "diagram.architectureResources.cpu" },
      { shape: "service", icon: Gpu, labelKey: "diagram.architectureResources.gpu" },
      { shape: "service", icon: MemoryStick, labelKey: "diagram.architectureResources.memory" },
      { shape: "service", icon: ServerCog, labelKey: "diagram.architectureResources.virtualMachine" },
      { shape: "service", icon: Container, labelKey: "diagram.architectureResources.container" },
      { shape: "service", icon: ShipWheel, labelKey: "diagram.architectureResources.kubernetes" },
      { shape: "service", icon: SquareFunction, labelKey: "diagram.architectureResources.serverless" },
    ],
  },
  {
    id: "ai",
    labelKey: "diagram.componentCategoryAi",
    tone: "text-fuchsia-600",
    items: [
      { shape: "service", icon: BrainCircuit, labelKey: "diagram.architectureResources.largeLanguageModel" },
      { shape: "service", icon: Sparkles, labelKey: "diagram.architectureResources.multimodalModel" },
      { shape: "service", icon: Binary, labelKey: "diagram.architectureResources.embeddingModel" },
      { shape: "service", icon: ArrowDownUp, labelKey: "diagram.architectureResources.reranker" },
      { shape: "service", icon: Microchip, labelKey: "diagram.architectureResources.modelInference" },
      { shape: "database", icon: Waypoints, labelKey: "diagram.architectureResources.vectorDatabase" },
      { shape: "service", icon: Workflow, labelKey: "diagram.architectureResources.ragPipeline" },
      { shape: "service", icon: Bot, labelKey: "diagram.architectureResources.aiAgent" },
      { shape: "service", icon: Router, labelKey: "diagram.architectureResources.modelGateway" },
      { shape: "service", icon: PlugZap, labelKey: "diagram.architectureResources.mcpServer" },
    ],
  },
  {
    id: "data",
    labelKey: "diagram.componentCategoryDatabases",
    tone: "text-violet-600",
    items: [
      { shape: "database", icon: Database, labelKey: "diagram.architectureResources.relationalDatabase" },
      { shape: "database", icon: DatabaseZap, labelKey: "diagram.architectureResources.noSqlDatabase" },
      { shape: "database", icon: Zap, labelKey: "diagram.architectureResources.cache" },
      { shape: "database", icon: Boxes, labelKey: "diagram.architectureResources.dataWarehouse" },
      { shape: "database", icon: Search, labelKey: "diagram.architectureResources.searchEngine" },
    ],
  },
  {
    id: "storage",
    labelKey: "diagram.componentCategoryStorage",
    tone: "text-lime-600",
    items: [
      { shape: "storage", icon: Cloud, labelKey: "diagram.architectureResources.objectStorage" },
      { shape: "storage", icon: FileStack, labelKey: "diagram.architectureResources.fileStorage" },
      { shape: "storage", icon: HardDrive, labelKey: "diagram.architectureResources.blockStorage" },
      { shape: "storage", icon: FolderArchive, labelKey: "diagram.architectureResources.backup" },
      { shape: "storage", icon: Radio, labelKey: "diagram.architectureResources.cdn" },
    ],
  },
  {
    id: "middleware",
    labelKey: "diagram.componentCategoryMiddleware",
    tone: "text-orange-600",
    items: [
      { shape: "queue", icon: ListOrdered, labelKey: "diagram.architectureResources.messageQueue" },
      { shape: "queue", icon: Share2, labelKey: "diagram.architectureResources.eventBus" },
      { shape: "queue", icon: WavesHorizontal, labelKey: "diagram.architectureResources.streamProcessing" },
      { shape: "service", icon: Webhook, labelKey: "diagram.architectureResources.webhook" },
      { shape: "service", icon: Grid2x2, labelKey: "diagram.architectureResources.serviceMesh" },
    ],
  },
  {
    id: "network",
    labelKey: "diagram.componentCategoryNetwork",
    tone: "text-blue-600",
    items: [
      { shape: "service", icon: Route, labelKey: "diagram.architectureResources.apiGateway" },
      { shape: "service", icon: GitFork, labelKey: "diagram.architectureResources.loadBalancer" },
      { shape: "external", icon: Compass, labelKey: "diagram.architectureResources.dns" },
      { shape: "boundary", icon: Network, labelKey: "diagram.architectureResources.vpc" },
      { shape: "boundary", icon: Cable, labelKey: "diagram.architectureResources.subnet" },
      { shape: "security", icon: EthernetPort, labelKey: "diagram.architectureResources.vpn" },
    ],
  },
  {
    id: "security",
    labelKey: "diagram.componentCategorySecurity",
    tone: "text-rose-600",
    items: [
      { shape: "security", icon: KeyRound, labelKey: "diagram.architectureResources.identity" },
      { shape: "security", icon: BrickWall, labelKey: "diagram.architectureResources.firewall" },
      { shape: "security", icon: ShieldCheck, labelKey: "diagram.architectureResources.waf" },
      { shape: "security", icon: LockKeyhole, labelKey: "diagram.architectureResources.secretManager" },
      { shape: "security", icon: ShieldEllipsis, labelKey: "diagram.architectureResources.certificate" },
      { shape: "boundary", icon: Box, labelKey: "diagram.architectureResources.systemBoundary" },
    ],
  },
  {
    id: "observability",
    labelKey: "diagram.componentCategoryObservability",
    tone: "text-teal-600",
    items: [
      { shape: "service", icon: Gauge, labelKey: "diagram.architectureResources.monitoring" },
      { shape: "service", icon: FileClock, labelKey: "diagram.architectureResources.logging" },
      { shape: "service", icon: ChartNoAxesCombined, labelKey: "diagram.architectureResources.metrics" },
      { shape: "service", icon: Activity, labelKey: "diagram.architectureResources.tracing" },
      { shape: "service", icon: CircleAlert, labelKey: "diagram.architectureResources.alerting" },
    ],
  },
  {
    id: "external",
    labelKey: "diagram.componentCategoryExternal",
    tone: "text-slate-600",
    items: [
      { shape: "external", icon: CloudCog, labelKey: "diagram.architectureResources.saas" },
      { shape: "external", icon: Braces, labelKey: "diagram.architectureResources.externalApi" },
      { shape: "external", icon: ExternalLink, labelKey: "diagram.architectureResources.thirdPartyService" },
    ],
  },
];

const architectureResourceIcon = (item: ArchitectureLibraryItem) =>
  item.labelKey.slice("diagram.architectureResources.".length) as ArchitectureResourceIcon;

const ARCHITECTURE_LIBRARY_ITEMS = ARCHITECTURE_LIBRARY_CATEGORIES.flatMap((category) => category.items);

const ARCHITECTURE_RESOURCE_ALIASES: Array<{
  pattern: RegExp;
  icon: ArchitectureResourceIcon;
}> = [
  { pattern: /\b(gpu|cuda|vram|graphics|显卡)\b|独立\s*gpu|gpu\s*核心|核显/i, icon: "gpu" },
  { pattern: /\b(cpu|soc|processor|core)\b|cpu\s*核心|中央处理器|处理器/i, icon: "cpu" },
  { pattern: /\b(memory|ram|vram|ddr|dram|unified\s*memory)\b|内存|统一内存|显存/i, icon: "memory" },
  { pattern: /\b(k8s|kubernetes|kube)\b/i, icon: "kubernetes" },
  { pattern: /\b(redis|memcached|cache)\b|缓存/i, icon: "cache" },
  { pattern: /\b(kafka|rabbitmq|rocketmq|activemq|pulsar|sqs|queue|mq)\b|消息队列/i, icon: "messageQueue" },
  { pattern: /\b(mysql|postgres|postgresql|oracle|sqlite|mariadb|db)\b|关系型数据库|数据库/i, icon: "relationalDatabase" },
  { pattern: /\b(mongo|mongodb|dynamodb|cassandra|couchbase|nosql)\b/i, icon: "noSqlDatabase" },
  { pattern: /\b(milvus|pinecone|qdrant|chroma|weaviate|vector)\b|向量/i, icon: "vectorDatabase" },
  { pattern: /\b(kong|apisix|gateway|zuul)\b|网关|api\s*网关/i, icon: "apiGateway" },
  { pattern: /\b(nginx|haproxy|alb|nlb|slb|load\s*balancer)\b|负载均衡/i, icon: "loadBalancer" },
  { pattern: /\b(docker|container|pod)\b|容器/i, icon: "container" },
  { pattern: /\b(llm|gpt|claude|gemini|deepseek|qwen|openai)\b|大模型|语言模型/i, icon: "largeLanguageModel" },
  { pattern: /\b(agent)\b|智能体/i, icon: "aiAgent" },
  { pattern: /\b(elasticsearch|es|opensearch|solr|meilisearch)\b|搜索/i, icon: "searchEngine" },
  { pattern: /\b(cdn|cloudflare|akamai)\b/i, icon: "cdn" },
  { pattern: /\b(dns|route53)\b/i, icon: "dns" },
  { pattern: /\b(lambda|serverless|faas|function)\b|函数/i, icon: "serverless" },
  { pattern: /\b(prometheus|grafana|datadog)\b|监控/i, icon: "monitoring" },
  { pattern: /\b(loki|elk|fluentd|logstash)\b|日志/i, icon: "logging" },
  { pattern: /\b(jaeger|zipkin|opentelemetry|otel|tracing)\b|链路追踪/i, icon: "tracing" },
  { pattern: /\b(s3|oss|cos|minio|blob)\b|对象存储/i, icon: "objectStorage" },
  { pattern: /\b(web|frontend|react|vue|angular|h5)\b|前端/i, icon: "webApp" },
  { pattern: /\b(app|ios|android|mobile|flutter|react\s*native)\b|移动端/i, icon: "mobileApp" },
  { pattern: /\b(service|microservice|backend|server)\b|服务|后端/i, icon: "service" },
];

const inferArchitectureResourceIcon = (
  label: string,
  t: (key: string) => string,
) => {
  const trimmed = label.trim();
  const directItem = ARCHITECTURE_LIBRARY_ITEMS.find((candidate) => (
    t(candidate.labelKey).toLowerCase() === trimmed.toLowerCase()
    || architectureResourceIcon(candidate).toLowerCase() === trimmed.toLowerCase()
  ));
  if (directItem) return architectureResourceIcon(directItem);
  const aliasMatch = ARCHITECTURE_RESOURCE_ALIASES.find((entry) => entry.pattern.test(trimmed));
  return aliasMatch ? aliasMatch.icon : undefined;
};

const isArchitectureLibraryDrag = (event: ReactDragEvent) => {
  const types = Array.from(event.dataTransfer.types).map((type) => type.toLowerCase());
  return types.includes(ARCHITECTURE_LIBRARY_DRAG_TYPE) || types.includes("text/plain");
};

const architectureLibraryDragIcon = (event: ReactDragEvent) => (
  event.dataTransfer.getData(ARCHITECTURE_LIBRARY_DRAG_TYPE)
  || event.dataTransfer.getData("text/plain")
) as ArchitectureResourceIcon;

const ArchitectureComponentLibrary = ({
  onPick,
  t,
}: {
  onPick: (item: ArchitectureLibraryItem) => void;
  t: (key: string) => string;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const draggingRef = useRef(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const categories = ARCHITECTURE_LIBRARY_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter((item) => t(item.labelKey).toLocaleLowerCase().includes(normalizedQuery)),
  })).filter((category) => category.items.length > 0);

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && draggingRef.current) return;
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <DiagramToolbarAddTrigger onPointerEnter={() => setOpen(true)} />
      <DropdownMenuContent
        align="start"
        className="max-h-[min(36rem,calc(100vh-8rem))] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto p-0"
        onPointerDownOutside={(event) => {
          if (draggingRef.current) event.preventDefault();
        }}
        onFocusOutside={(event) => {
          if (draggingRef.current) event.preventDefault();
        }}
      >
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-card p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              autoFocus
              className="h-9 pl-9"
              value={query}
              placeholder={t("diagram.componentSearch")}
              aria-label={t("diagram.componentSearch")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
        <div className="p-1.5">
          {categories.length > 0 ? categories.map((category) => (
            <Collapsible key={category.id} defaultOpen>
              <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
                <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/25">
                  <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-data-[state=closed]:-rotate-90" />
                  {t(category.labelKey)}
                </CollapsibleTrigger>
              </DropdownMenuItem>
              <CollapsibleContent>
                <div className="grid grid-cols-7 gap-1 px-1 pb-2">
                  {category.items.map((item) => {
                    const Icon = item.icon;
                    const label = t(item.labelKey);
                    return (
                      <Tooltip key={item.labelKey}>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            aria-label={label}
                            className={cn("flex h-10 w-10 cursor-grab justify-center rounded-lg p-0 hover:bg-current/10 focus:bg-current/10 active:cursor-grabbing", category.tone)}
                            draggable
                            onPointerDown={(event) => event.stopPropagation()}
                            onDragStart={(event) => {
                              draggingRef.current = true;
                              event.stopPropagation();
                              const icon = architectureResourceIcon(item);
                              event.dataTransfer.effectAllowed = "copy";
                              event.dataTransfer.setData("text/plain", icon);
                              event.dataTransfer.setData(ARCHITECTURE_LIBRARY_DRAG_TYPE, icon);
                            }}
                            onDragEnd={() => {
                              draggingRef.current = false;
                              setOpen(false);
                            }}
                            onSelect={() => {
                              onPick(item);
                              setOpen(false);
                            }}
                          >
                            <Icon className="h-5 w-5" />
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-48">
                          <div>{label}</div>
                          <div className="text-xs text-slate-300">{t("diagram.placeShapeHelp")}</div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )) : (
            <div className="px-3 py-8 text-center text-sm text-slate-500">{t("diagram.noMatchingComponents")}</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ArchitectureIconPicker = ({
  currentIcon,
  onSelectIcon,
  t,
}: {
  currentIcon: ArchitectureResourceIcon;
  onSelectIcon: (icon: ArchitectureResourceIcon) => void;
  t: (key: string) => string;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const categories = ARCHITECTURE_LIBRARY_CATEGORIES.map((category) => ({
    ...category,
    items: category.items.filter((item) => t(item.labelKey).toLocaleLowerCase().includes(normalizedQuery)),
  })).filter((category) => category.items.length > 0);

  const CurrentLucide = ARCHITECTURE_LIBRARY_ITEMS.find(
    (item) => architectureResourceIcon(item) === currentIcon,
  )?.icon ?? Server;

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-md border-slate-200 bg-card p-0 text-slate-700 hover:bg-slate-50 focus-visible:ring-1 focus-visible:ring-slate-900/25"
              aria-label={t("diagram.changeNodeIcon")}
            >
              <CurrentLucide className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div>{t("diagram.changeNodeIcon")}</div>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(28rem,calc(100vh-10rem))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-0"
      >
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-card p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              autoFocus
              className="h-8 pl-8 text-xs"
              value={query}
              placeholder={t("diagram.componentSearch")}
              aria-label={t("diagram.componentSearch")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
        <div className="p-1.5">
          {categories.length > 0 ? categories.map((category) => (
            <Collapsible key={category.id} defaultOpen>
              <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
                <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-900/25">
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-data-[state=closed]:-rotate-90" />
                  {t(category.labelKey)}
                </CollapsibleTrigger>
              </DropdownMenuItem>
              <CollapsibleContent>
                <div className="grid grid-cols-6 gap-1 px-1 pb-1.5">
                  {category.items.map((item) => {
                    const Icon = item.icon;
                    const resIcon = architectureResourceIcon(item);
                    const label = t(item.labelKey);
                    const isSelected = resIcon === currentIcon;
                    return (
                      <Tooltip key={item.labelKey}>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            aria-label={label}
                            className={cn(
                              "flex h-9 w-9 cursor-pointer justify-center rounded-lg p-0 hover:bg-current/10 focus:bg-current/10",
                              category.tone,
                              isSelected && "ring-2 ring-current font-bold",
                            )}
                            onSelect={() => {
                              onSelectIcon(resIcon);
                              setOpen(false);
                            }}
                          >
                            <Icon className="h-4 w-4" />
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div>{label}</div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )) : (
            <div className="px-3 py-6 text-center text-xs text-slate-500">{t("diagram.noMatchingComponents")}</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const DiagramInsertMenu = ({
  items,
}: {
  items: Array<{ icon: LucideIcon; label: string; onSelect: () => void }>;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DiagramToolbarAddTrigger onPointerEnter={() => setOpen(true)} />
      <DropdownMenuContent align="start">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
              <Icon className="h-4 w-4" />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const FLOW_ACTIVE_NODE_CLASS = "edgeever-flow-node-active";
const FLOW_PORT_HIT_RADIUS = 14;
const FLOW_PORT_DOT_RADIUS = 7;
const FLOW_QUICK_CREATE_WIDTH = 330;
const FLOW_QUICK_CREATE_HEIGHT = 132;
const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const isConnectableDiagram = (kind: DiagramDocument["kind"]) => kind !== "mind-map";
const usesOrthogonalDiagramEdges = (kind: DiagramDocument["kind"]) => kind === "flowchart" || kind === "architecture";
const architectureNodeLabel = (shape: DiagramNodeShape, t: (key: string) => string) => {
  const labels: Partial<Record<DiagramNodeShape, string>> = {
    client: t("diagram.newClient"),
    frontend: t("diagram.newFrontend"),
    service: t("diagram.newService"),
    database: t("diagram.newDatabase"),
    storage: t("diagram.newStorage"),
    queue: t("diagram.newQueue"),
    security: t("diagram.newSecurity"),
    external: t("diagram.newExternal"),
    boundary: t("diagram.newBoundary"),
  };
  return labels[shape] ?? t("diagram.newService");
};
const oppositeFlowPort = (port?: FlowPort): FlowPort | undefined => port ? ({
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
} as const)[port] : undefined;

const removeFlowDraftEdge = (graph: Graph, edge: Edge, restoreHistory: boolean) => {
  if (graph.isHistoryEnabled()) graph.disableHistory();
  graph.removeCell(edge);
  if (restoreHistory) graph.enableHistory();
};

const setFlowNodePortsActive = (graph: Graph, node: Node, active: boolean) => {
  const apply = () => {
    const view = graph.findViewByCell(node);
    if (!view) return false;
    if (active) view.addClass(FLOW_ACTIVE_NODE_CLASS);
    else view.removeClass(FLOW_ACTIVE_NODE_CLASS);
    view.container.querySelectorAll<SVGElement>(".x6-port-body").forEach((port) => {
      port.style.setProperty("opacity", active ? "1" : "0", "important");
      port.style.setProperty("pointer-events", active ? "auto" : "none", "important");
      const dot = port.querySelector<SVGElement>(".edgeever-flow-port-dot") ?? port;
      if (active) {
        dot.style.setProperty("fill", "var(--brand-green)", "important");
        dot.style.setProperty("stroke", "var(--workspace-editor)", "important");
        dot.style.setProperty("stroke-width", "2px", "important");
        dot.style.setProperty("filter", "drop-shadow(0 1px 3px rgb(var(--brand-green-rgb) / 0.3))");
      } else {
        dot.style.removeProperty("fill");
        dot.style.removeProperty("stroke");
        dot.style.removeProperty("stroke-width");
        dot.style.removeProperty("filter");
      }
    });
    return true;
  };
  if (!apply()) window.requestAnimationFrame(apply);
};

const setOnlyFlowNodePortsActive = (graph: Graph, activeNode?: Node) => {
  graph.getNodes().forEach((node) => setFlowNodePortsActive(graph, node, node.id === activeNode?.id));
};

const diagramCanvasColor = (
  kind: DiagramDocument["kind"],
  theme: DiagramTheme,
  appearance: DiagramAppearance,
) => (kind === "flowchart"
  ? resolveFlowchartSurface(appearance, theme).canvas
  : kind === "architecture"
    ? resolveArchitectureSurface(appearance).canvas
    : resolveDiagramPalette(theme, appearance).canvas);

const applyDiagramSurface = (
  graph: Graph,
  theme: DiagramTheme,
  appearance: DiagramAppearance,
  kind?: DiagramDocument["kind"],
) => {
  const color = diagramCanvasColor(kind ?? "mind-map", theme, appearance);
  graph.drawBackground({ color });
  getDiagramScroller(graph)?.container.style.setProperty("--edgeever-diagram-canvas", color);
  if (kind === "architecture" || kind === "flowchart") {
    graph.drawGrid({
      type: "dot",
      args: {
        color: appearance === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.08)",
        thickness: 1.2,
      },
    });
    graph.showGrid();
  } else {
    graph.clearGrid();
  }
};

const prepareExportSvg = (background: string) => (svg: SVGSVGElement) => {
  svg.querySelectorAll<SVGElement>(".x6-node, .x6-edge").forEach((element) => {
    element.removeAttribute("display");
    element.style.removeProperty("display");
  });
  svg.querySelectorAll(".x6-port").forEach((element) => element.remove());
  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) return;
  const [x, y, width, height] = viewBox;
  const rect = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("fill", background);
  svg.insertBefore(rect, svg.firstChild);
};

const createLocalEditSession = (memo: MemoDetail): MemoEditSession => ({
  id: `local-edit:${memo.id}`,
  memoId: memo.id,
  baseRevision: memo.revision,
  baseContentHash: memo.contentHash,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

// X6 Scroller autoResize is debounced 200ms and then calls fitToContent. Batch
// inserts must settle it synchronously so rendering and hit-testing share the
// same paper bounds. Preserve an existing rendered node as a pixel anchor:
// X6's center restoration uses paper coordinates and can drift when
// fitToContent changes a negative origin.
const SCROLLER_AUTORESIZE_SETTLE_MS = 250;
const ARCHITECTURE_DROP_VIEWPORT_PADDING = 12;

const getDiagramScroller = (graph: Graph) => graph.getPlugin("scroller") as Scroller | undefined;

const diagramNodeBounds = (graph: Graph) => {
  const nodes = graph.getNodes();
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const position = node.getPosition();
    const size = node.getSize();
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + size.width);
    maxY = Math.max(maxY, position.y + size.height);
  }
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return isUsableDiagramBounds(bounds) ? bounds : null;
};

const bindDiagramScrollerFit = (graph: Graph) => {
  const current = graph.fitToContent as typeof graph.fitToContent & { edgeeverBound?: boolean };
  if (current.edgeeverBound) return;
  const original = current.bind(graph);
  const bound = ((
    gridWidth?: unknown,
    gridHeight?: number,
    padding?: unknown,
    options?: Record<string, unknown>,
  ) => {
    const bounds = diagramNodeBounds(graph);
    if (gridWidth && typeof gridWidth === "object") {
      return original(applyDiagramScrollerFitOptions({ ...(gridWidth as Record<string, unknown>) }, bounds));
    }
    return original(
      gridWidth as number | undefined,
      gridHeight,
      padding as number | undefined,
      applyDiagramScrollerFitOptions({ ...(options ?? {}) }, bounds),
    );
  }) as typeof graph.fitToContent & { edgeeverBound?: boolean };
  bound.edgeeverBound = true;
  graph.fitToContent = bound;
};

const ensureDiagramPaperContainsNodes = (graph: Graph) => {
  const bounds = diagramNodeBounds(graph);
  if (!bounds) return;
  graph.transform.fitToContent({
    allowNewOrigin: "any",
    padding: 48,
    gridWidth: 1,
    gridHeight: 1,
    contentArea: bounds,
  });
};

const zoomDiagram = (graph: Graph, factor: number, absolute = false) => {
  const scroller = getDiagramScroller(graph);
  if (scroller) {
    if (absolute) scroller.zoomTo(factor);
    else scroller.zoom(factor);
    return;
  }
  if (absolute) graph.zoomTo(factor);
  else graph.zoom(factor);
};

const fitDiagramRect = (
  graph: Graph,
  bounds: { x: number; y: number; width: number; height: number },
  options: { padding: number; maxScale: number },
) => {
  const scroller = getDiagramScroller(graph);
  if (scroller) scroller.zoomToRect(bounds, options);
  else graph.zoomToRect(bounds, options);
};

const centerDiagramContent = (graph: Graph) => {
  const scroller = getDiagramScroller(graph);
  if (scroller) {
    scroller.centerContent();
    return;
  }
  graph.centerContent();
};

const diagramClientToLocalPoint = (graph: Graph, point: { x: number; y: number }) => {
  const anchorNode = graph.getNodes().find((node) => node.isVisible());
  const anchorView = anchorNode ? graph.findViewByCell(anchorNode) : null;
  if (anchorNode && anchorView) {
    const clientBounds = anchorView.container.getBoundingClientRect();
    const localBounds = anchorNode.getBBox();
    if (clientBounds.width > 0 && clientBounds.height > 0) {
      return {
        x: localBounds.x + (point.x - clientBounds.left) * localBounds.width / clientBounds.width,
        y: localBounds.y + (point.y - clientBounds.top) * localBounds.height / clientBounds.height,
      };
    }
  }
  const scroller = getDiagramScroller(graph);
  if (!scroller) return graph.clientToLocal(point);
  const bounds = scroller.container.getBoundingClientRect();
  return scroller.clientToLocalPoint(point.x - bounds.left, point.y - bounds.top);
};

const clampArchitectureDropClientPoint = (
  graph: Graph,
  surface: HTMLElement | null,
  item: ArchitectureLibraryItem,
  point: { x: number; y: number },
) => {
  if (!surface) return point;
  const bounds = surface.getBoundingClientRect();
  const size = compactArchitectureNodeSize(item.shape);
  const scale = graph.scale();
  const horizontalInset = size.width * scale.sx / 2 + ARCHITECTURE_DROP_VIEWPORT_PADDING;
  const verticalInset = size.height * scale.sy / 2 + ARCHITECTURE_DROP_VIEWPORT_PADDING;
  return {
    x: Math.min(
      Math.max(point.x, bounds.left + horizontalInset),
      Math.max(bounds.left + horizontalInset, bounds.right - horizontalInset),
    ),
    y: Math.min(
      Math.max(point.y, bounds.top + verticalInset),
      Math.max(bounds.top + verticalInset, bounds.bottom - verticalInset),
    ),
  };
};

const suspendScrollerAutoResize = (
  graph: Graph,
  timerRef: { current: number | null },
  isCurrent: () => boolean,
  options: { restoreAnchor?: boolean } = {},
) => {
  const scroller = getDiagramScroller(graph);
  if (!scroller) return () => undefined;
  const restoreAnchor = options.restoreAnchor !== false;
  const anchorView = restoreAnchor
    ? graph.getNodes()
      .map((node) => graph.findViewByCell(node))
      .find((view) => view?.container.isConnected)
    : undefined;
  const anchorBefore = anchorView?.container.getBoundingClientRect();
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!isCurrent()) return;
    scroller.enableAutoResize();
    scroller.updateScroller();
    // Scroller.update() can retain the pre-insert paper size even though the
    // model already contains the new cell. Refit from model geometry before
    // restoring the viewport anchor so the new node and the existing diagram
    // cannot be clipped until the editor is reloaded.
    ensureDiagramPaperContainsNodes(graph);
    if (!restoreAnchor || !anchorView || !anchorBefore) return;
    const keepAnchor = () => {
      if (!isCurrent() || !anchorView || !anchorBefore) return;
      const anchorAfter = anchorView.container.getBoundingClientRect();
      const scroll = scroller.getScrollbarPosition();
      scroller.setScrollbarPosition(
        scroll.left + anchorAfter.left - anchorBefore.left,
        scroll.top + anchorAfter.top - anchorBefore.top,
      );
    };
    keepAnchor();
    requestAnimationFrame(keepAnchor);
  };
  scroller.disableAutoResize();
  if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  timerRef.current = window.setTimeout(settle, SCROLLER_AUTORESIZE_SETTLE_MS);
  return settle;
};

const revealDiagramNode = (graph: Graph, node: Node) => {
  ensureDiagramPaperContainsNodes(graph);
  const box = node.getBBox();
  const scroller = getDiagramScroller(graph);
  if (scroller) scroller.centerPoint(box.x + box.width / 2, box.y + box.height / 2);
  else graph.centerCell(node);
};

const nodeEditorState = (
  graph: Graph,
  node: Node,
  theme: DiagramTheme,
  appearance: DiagramAppearance,
  host?: HTMLElement | null,
): NodeEditorState => {
  const data = node.getData<NodeData>();
  const bbox = node.getBBox();
  const topLeft = graph.localToClient({ x: bbox.x, y: bbox.y });
  const bottomRight = graph.localToClient({ x: bbox.x + bbox.width, y: bbox.y + bbox.height });
  const origin = (host ?? graph.container).getBoundingClientRect();
  const isRootTopic = data?.shape === "topic" && !data.parentId;
  const mindNodes = graph.getNodes().map((item) => ({
    id: item.id,
    parentId: item.getData<NodeData>()?.parentId,
    ...item.getPosition(),
    ...item.getSize(),
  }));
  const mindRole = data?.shape === "topic" ? mindMapNodeRole(mindNodes, node.id) : null;
  const mindStyle = mindRole
    ? resolveMindMapNodeStyle(mindNodes, node.id, resolveDiagramPalette(theme, appearance), theme, appearance, node.getSize())
    : null;
  const flowchartStyle = !mindRole && (data?.shape === "process" || data?.shape === "decision" || data?.shape === "terminator")
    ? flowchartNodeVisual(data.shape, appearance, node.getSize(), theme)
    : null;
  const architectureStyle = !mindRole && !flowchartStyle && data?.shape && isArchitectureNodeShape(data.shape)
    ? architectureNodeVisual(data.shape, appearance, node.getSize(), data.resourceIcon)
    : null;
  const attrs = mindStyle
    ? mindStyle.visual
    : flowchartStyle ?? architectureStyle ?? nodeAttrs(data?.shape ?? "process", theme, appearance, isRootTopic);
  return {
    nodeId: node.id,
    originalValue: data?.label ?? "",
    value: data?.label ?? "",
    shape: data?.shape ?? "process",
    left: topLeft.x - origin.left,
    top: topLeft.y - origin.top,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
    fontSize: (mindRole ? attrs.label.fontSize : data?.shape === "topic" ? 14 : 13) * graph.scale().sx,
    color: String(attrs.label.fill),
    background: String(attrs.body.fill === "transparent"
      ? (architectureStyle ? resolveArchitectureSurface(appearance).canvas : resolveDiagramPalette(theme, appearance).canvas)
      : attrs.body.fill),
    borderColor: String(attrs.body.stroke),
  };
};

const nodeAttrs = (
  shape: DiagramNodeShape,
  theme: DiagramTheme,
  appearance: DiagramAppearance,
  isRootTopic = false,
) => {
  const palette = resolveDiagramPalette(theme, appearance);
  const isTerminator = shape === "terminator";
  const isAccent = isRootTopic || isTerminator;
  return {
    body: {
      fill: isAccent ? palette.topicFill : palette.nodeFill,
      stroke: isAccent ? palette.topicStroke : palette.nodeStroke,
      strokeWidth: isAccent ? 1.5 : 1,
      rx: isTerminator ? 24 : 11,
      ry: isTerminator ? 24 : 11,
      ...(shape === "decision" ? { refPoints: "0,10 10,0 20,10 10,20" } : {}),
    },
    label: {
      fill: isAccent ? palette.topicText : palette.nodeText,
      fontSize: shape === "topic" ? 14 : 13,
      fontWeight: isAccent ? 650 : 500,
    },
  };
};

// Reuse X6's measured text wrapping so on-screen labels and SVG/PNG exports agree.
const diagramNodePresentation = (
  node: DiagramDocument["nodes"][number],
  kind: DiagramDocument["kind"],
  allNodes: Array<{ id: string; parentId?: string }> = [node],
  structure?: DiagramStructure,
) => {
  if (kind === "flowchart") return flowchartNodePresentation(node.shape, node.label);
  if (kind === "mind-map") return mindMapNodePresentation(node.label, mindMapNodeRole(allNodes, node.id), structure);
  const size = kind === "architecture"
    ? compactArchitectureNodeSize(node.shape, node)
    : compactFlowchartNodeSize(node.shape);
  if (node.shape === "boundary") return { ...size, text: node.label };
  const fontSize = kind === "architecture" ? ARCHITECTURE_NODE_FONT_SIZE : 13;
  const lineHeight = kind === "architecture" ? ARCHITECTURE_NODE_LINE_HEIGHT : 18;
  const text = Dom.breakText(node.label, { width: size.width - (kind === "architecture" ? 66 : 24), height: 10000 }, {
    fontSize, 'font-size': fontSize, 'font-weight': kind === "architecture" ? ARCHITECTURE_NODE_FONT_WEIGHT : !node.parentId ? 650 : 500,
    lineHeight,
  });
  const lineCount = text.split("\n").length;
  return {
    ...size,
    height: kind === "architecture"
      ? architectureNodeHeight(node.shape, lineCount)
      : Math.max(size.height, lineCount * lineHeight + 16),
    text,
  };
};

const diagramNodeSize = (node: DiagramDocument["nodes"][number], kind: DiagramDocument["kind"], structure?: DiagramStructure) => {
  const { width, height } = diagramNodePresentation(node, kind, [node], structure);
  return { width, height };
};

const refreshNodeLabel = (node: Node, label: string, structure?: DiagramStructure) => {
  const data = node.getData<NodeData>();
  const shape = data?.shape ?? "process";
  if (shape === "boundary") {
    node.attr("label/text", label);
    return;
  }
  const kind = shape === "topic" ? "mind-map" : isArchitectureNodeShape(shape) ? "architecture" : "flowchart";
  const graphNodes = kind === "mind-map" ? node.model?.getNodes() : undefined;
  const allNodes = graphNodes?.map((item) => ({
    id: item.id,
    parentId: item.getData<NodeData>()?.parentId,
  }));
  const presentation = diagramNodePresentation({ id: node.id, ...node.getPosition(), ...node.getSize(), ...data, shape, label }, kind, allNodes, structure);
  const currentSize = node.getSize();
  if (currentSize.width !== presentation.width || currentSize.height !== presentation.height) {
    node.resize(presentation.width, presentation.height);
  }
  node.attr("label/text", presentation.text);
  if (kind === "architecture") {
    const iconY = architectureIconOffset(presentation.height);
    node.attr("iconFrame/y", iconY);
    for (const selector of Object.keys(node.getAttrs()).filter((name) => name.startsWith("architectureIcon"))) {
      node.attr(`${selector}/transform`, `translate(15 ${iconY + 5})`);
    }
  }
};

const flowPortGroup = (
  position: FlowPort,
  palette: ReturnType<typeof resolveDiagramPalette>,
) => ({
  position,
  markup: [
    { tagName: "circle", selector: "hitArea", className: "edgeever-flow-port-hit-area" },
    { tagName: "circle", selector: "circle", className: "edgeever-flow-port-dot" },
  ],
  attrs: {
    hitArea: {
      r: FLOW_PORT_HIT_RADIUS,
      magnet: true,
      fill: "transparent",
      stroke: "transparent",
      pointerEvents: "all",
    },
    circle: {
      r: FLOW_PORT_DOT_RADIUS,
      stroke: palette.topicStroke,
      fill: palette.canvas,
      strokeWidth: 2,
      pointerEvents: "none",
    },
  },
});

const nodeMetadata = (
  node: DiagramDocument["nodes"][number],
  theme: DiagramTheme,
  kind: DiagramDocument["kind"],
  appearance: DiagramAppearance,
  structure?: DiagramStructure,
) => {
  const isDecision = node.shape === "decision";
  const isRootTopic = node.shape === "topic" && !node.parentId;
  const palette = resolveDiagramPalette(theme, appearance);
  const size = diagramNodeSize(node, kind, structure);
  const mindStyle = kind === "mind-map"
    ? resolveMindMapNodeStyle([node], node.id, palette, theme, appearance, size, structure)
    : null;
  const flowchartStyle = kind === "flowchart" ? flowchartNodeVisual(node.shape, appearance, size, theme) : null;
  const architectureStyle = kind === "architecture"
    ? architectureNodeVisual(node.shape, appearance, size, node.resourceIcon)
    : null;
  const visualAttrs = mindStyle
    ? mindStyle.visual
    : flowchartStyle ?? architectureStyle ?? nodeAttrs(node.shape, theme, appearance, isRootTopic);
  const hasPorts = isConnectableDiagram(kind) && node.shape !== "boundary";
  const flowchartSurface = kind === "flowchart" ? resolveFlowchartSurface(appearance, theme) : null;
  const architectureSurface = kind === "architecture" ? resolveArchitectureSurface(appearance) : null;
  const portPalette = flowchartSurface
    ? { ...palette, canvas: flowchartSurface.canvas, topicStroke: flowchartSurface.terminator.stroke }
    : architectureSurface
      ? { ...palette, canvas: architectureSurface.canvas, topicStroke: architectureSurface.nodes.service.stroke }
      : palette;
  return {
    id: node.id,
    shape: isDecision ? "polygon" : "rect",
    x: node.x,
    y: node.y,
    width: size.width,
    height: size.height,
    zIndex: node.shape === "boundary" ? 0 : 2,
    data: {
      label: node.label,
      shape: node.shape,
      ...(node.parentId ? { parentId: node.parentId } : {}),
      ...(node.resourceIcon ? { resourceIcon: node.resourceIcon } : {}),
    } satisfies NodeData,
    ...(architectureStyle ? { markup: architectureStyle.markup } : mindStyle ? { markup: mindMapTopicMarkup(structure, mindStyle.role) } : {}),
    attrs: {
      body: visualAttrs.body,
      ...(mindStyle ? { underline: mindStyle.visual.underline } : {}),
      label: {
        ...visualAttrs.label,
        text: diagramNodePresentation(node, kind).text,
        lineHeight: mindStyle?.visual.label.lineHeight ?? flowchartStyle?.label.lineHeight ?? architectureStyle?.label.lineHeight ?? 18,
      },
      ...(architectureStyle?.attrs ?? {}),
    },
    ...(hasPorts ? { ports: {
      groups: {
        top: flowPortGroup("top", portPalette),
        right: flowPortGroup("right", portPalette),
        bottom: flowPortGroup("bottom", portPalette),
        left: flowPortGroup("left", portPalette),
      },
      items: ["top", "right", "bottom", "left"].map((group) => ({ id: group, group })),
    } } : {}),
  };
};

const diagramEdgeLabel = (
  text: string,
  palette: ReturnType<typeof resolveDiagramPalette>,
  kind: DiagramDocument["kind"],
  appearance: DiagramAppearance = "light",
  theme?: DiagramTheme,
  edgeKind?: DiagramEdgeKind,
) => {
  if (kind === "architecture") {
    const edgePaint = edgeKind ? resolveArchitectureSurface(appearance).edges[edgeKind] : undefined;
    return {
      position: { distance: 0.5, offset: { x: 0, y: -14 } },
      attrs: {
        label: {
          text,
          fill: appearance === "dark" ? "#E2E8F0" : "#334155",
          fontSize: ARCHITECTURE_EDGE_LABEL_FONT_SIZE,
          fontWeight: 500,
          fontFamily: ARCHITECTURE_LABEL_FONT,
          lineHeight: ARCHITECTURE_EDGE_LABEL_LINE_HEIGHT,
          textWrap: { width: 140, height: 512 },
        },
        body: {
          ref: "label",
          refWidth: 1,
          refHeight: 1,
          refWidth2: 14,
          refHeight2: 6,
          refX: -7,
          refY: -3,
          fill: appearance === "dark" ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.96)",
          stroke: edgePaint?.stroke ?? (appearance === "dark" ? "rgba(148, 163, 184, 0.3)" : "rgba(203, 213, 225, 0.8)"),
          strokeWidth: 1,
          rx: 6,
          ry: 6,
          style: { filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.05))" },
        },
      },
    };
  }
  if (kind === "flowchart") {
    return {
      position: { distance: 0.5, offset: 0 },
      attrs: {
        label: {
          text,
          fill: appearance === "dark" ? "#E2E8F0" : "#475569",
          fontSize: FLOWCHART_EDGE_LABEL_FONT_SIZE,
          fontWeight: 500,
          fontFamily: FLOWCHART_LABEL_FONT,
          lineHeight: FLOWCHART_EDGE_LABEL_LINE_HEIGHT,
          textWrap: { width: 140, height: 512 },
        },
        body: {
          ref: "label",
          refWidth: 1,
          refHeight: 1,
          refWidth2: 14,
          refHeight2: 6,
          refX: -7,
          refY: -3,
          fill: appearance === "dark" ? "rgba(24, 28, 34, 0.94)" : "rgba(255, 255, 255, 0.95)",
          stroke: appearance === "dark" ? "rgba(148, 163, 184, 0.28)" : "rgba(100, 116, 139, 0.24)",
          strokeWidth: 1,
          rx: 6,
          ry: 6,
          style: { filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.06))" },
        },
      },
    };
  }
  const flowchart = null;
  return {
    position: { distance: 0.5, offset: 0 },
    attrs: {
      label: {
        text,
        fill: palette.nodeText,
        fontSize: MIND_MAP_EDGE_LABEL_FONT_SIZE,
        lineHeight: MIND_MAP_EDGE_LABEL_LINE_HEIGHT,
        textWrap: { width: 140, height: 512 },
      },
      body: { ref: "label", refWidth: 1, refHeight: 1, refWidth2: 12, refHeight2: 8, refX: -6, refY: -4,
        fill: palette.canvas,
        stroke: palette.nodeStroke, strokeWidth: 1, rx: 4, ry: 4 },
    },
  };
};

const edgeMetadata = (
  edge: DiagramDocument["edges"][number],
  kind: DiagramDocument["kind"],
  theme: DiagramTheme,
  appearance: DiagramAppearance,
  structure?: DiagramStructure,
) => {
  const palette = resolveDiagramPalette(theme, appearance);
  const edgeKind = edge.kind ?? (kind === "architecture" ? "dependency" : undefined);
  const mindEdge = kind === "mind-map" ? mindMapEdgeVisual("primary", palette) : null;
  const flowchartSurface = kind === "flowchart" ? resolveFlowchartSurface(appearance, theme) : null;
  const architectureEdge = kind === "architecture"
    ? architectureEdgeVisual(edgeKind, appearance, edge.bidirectional)
    : null;
  const edgeStroke = architectureEdge?.stroke ?? mindEdge?.stroke ?? flowchartSurface?.edge ?? palette.flowEdge;
  const mindLine = mindEdge ? mindMapEdgeLineAttrs(structure, edgeStroke) : null;
  return {
    id: edge.id,
    source: { cell: edge.source },
    target: { cell: edge.target },
    router: kind === "architecture"
      ? architectureEdgeRouter(edge.source, edge.target, [])
      : usesOrthogonalDiagramEdges(kind) ? FLOWCHART_EDGE_ROUTER : undefined,
    connector: kind === "mind-map"
      ? { name: MIND_MAP_CONNECTOR_NAME, args: { sourceWidth: mindEdge?.sourceWidth, targetWidth: mindEdge?.targetWidth, structure } }
      : { name: "rounded", args: { radius: 10 } },
    data: { ...(edgeKind ? { kind: edgeKind } : {}), ...(edge.bidirectional ? { bidirectional: true } : {}) } satisfies EdgeData,
    attrs: {
      line: {
        stroke: edgeStroke,
        strokeWidth: architectureEdge?.strokeWidth ?? mindLine?.strokeWidth ?? 1.5,
        strokeDasharray: architectureEdge?.strokeDasharray,
        sourceMarker: architectureEdge
          ? architectureEdge.sourceMarker
          : edge.bidirectional ? { name: "block", width: 7, height: 5 } : null,
        targetMarker: kind === "mind-map" ? null : architectureEdge?.targetMarker ?? { name: "block", width: 7, height: 5 },
        ...(mindLine ?? { fill: "none" }),
      },
    },
    labels: edge.label ? [diagramEdgeLabel(edge.label, palette, kind, appearance, theme, edgeKind)] : undefined,
  };
};

const applyOrthogonalEdgePorts = (graph: Graph, kind: DiagramDocument["kind"]) => {
  const boundaryIds = kind === "architecture"
    ? graph.getNodes().filter((node) => node.getData<NodeData>()?.shape === "boundary").map((node) => node.id)
    : [];
  const architectureTerminals = kind === "architecture"
    ? architectureEdgeTerminals(
      graph.getNodes().filter((node) => !boundaryIds.includes(node.id)).map((node) => ({
        id: node.id, ...node.getPosition(), ...node.getSize(),
      })),
      graph.getEdges().map((edge) => ({ id: edge.id, source: edge.getSourceCellId(), target: edge.getTargetCellId() })),
    )
    : null;
  for (const edge of graph.getEdges()) {
    const source = edge.getSourceNode();
    const target = edge.getTargetNode();
    if (!source || !target) continue;
    const sourceBox = { ...source.getPosition(), ...source.getSize() };
    const targetBox = { ...target.getPosition(), ...target.getSize() };
    const ports = kind === "architecture"
      ? architectureEdgePorts(sourceBox, targetBox)
      : flowchartEdgePorts(sourceBox, targetBox);
    const terminal = architectureTerminals?.get(edge.id);
    edge.setSource(terminal
      ? { cell: source.id, anchor: architectureTerminalAnchor(terminal.source) }
      : { cell: source.id, port: ports.source });
    edge.setTarget(terminal
      ? { cell: target.id, anchor: architectureTerminalAnchor(terminal.target) }
      : { cell: target.id, port: ports.target });
    edge.setRouter(kind === "architecture"
      ? architectureEdgeRouter(source.id, target.id, boundaryIds, ports)
      : flowchartEdgeIsStraight(sourceBox, targetBox) ? { name: "normal" } : FLOWCHART_EDGE_ROUTER);
  }
};

const graphToDocument = (graph: Graph, kind: DiagramDocument["kind"], theme: DiagramTheme, structure?: DiagramStructure): DiagramDocument => ({
  schemaVersion: kind === "architecture" ? ARCHITECTURE_DIAGRAM_SCHEMA_VERSION : DIAGRAM_SCHEMA_VERSION,
  kind,
  theme,
  ...(kind === "mind-map" ? { structure: resolveDiagramStructure(structure) } : {}),
  nodes: graph.getNodes().map((node) => {
    const data = node.getData<NodeData>();
    const position = node.getPosition();
    const size = node.getSize();
    return {
      id: node.id,
      label: data?.label ?? String(node.attr("label/text") ?? ""),
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: Math.round(size.width),
      height: Math.round(size.height),
      shape: data?.shape ?? "process",
      ...(data?.parentId && graph.getCellById(data.parentId)?.isNode() ? { parentId: data.parentId } : {}),
      ...(data?.resourceIcon ? { resourceIcon: data.resourceIcon } : {}),
    };
  }),
  edges: graph.getEdges().flatMap((edge) => {
    const source = edge.getSourceCellId();
    const target = edge.getTargetCellId();
    if (!source || !target) return [];
    const label = edge.getLabels()[0]?.attrs?.label?.text;
    const data = edge.getData<EdgeData>();
    return [{
      id: edge.id,
      source,
      target,
      ...(typeof label === "string" && label ? { label } : {}),
      ...(data?.kind ? { kind: data.kind } : {}),
      ...(data?.bidirectional ? { bidirectional: true } : {}),
    }];
  }),
});

const removeGraphSelection = (graph: Graph) => {
  const selected = graph.getSelectedCells();
  if (selected.length === 0) return false;
  const removalIds = new Set(selected.map((cell) => cell.id));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of graph.getNodes()) {
      const parentId = node.getData<NodeData>()?.parentId;
      if (parentId && removalIds.has(parentId) && !removalIds.has(node.id)) {
        removalIds.add(node.id);
        expanded = true;
      }
    }
  }
  const cells = [...removalIds].map((id) => graph.getCellById(id)).filter((cell) => Boolean(cell));
  graph.startBatch("remove");
  for (const cell of cells) {
    if (cell.isNode()) graph.removeConnectedEdges(cell);
  }
  graph.removeCells(cells);
  graph.stopBatch("remove");
  return true;
};


const diagramViewportSize = (graph: Graph, container: HTMLElement | null) => {
  const host = getDiagramScroller(graph)?.container ?? container;
  if (!host) return null;
  return { width: host.clientWidth, height: host.clientHeight };
};

const readDiagramContent = (graph: Graph, document: DiagramDocument) => {
  const policy = getDiagramLayoutViewport(document.kind);
  const focus = diagramReaderFocusNode(document);
  const cell = focus ? graph.getCellById(focus.id) : null;
  ensureDiagramPaperContainsNodes(graph);
  zoomDiagram(graph, 1, true);
  ensureDiagramPaperContainsNodes(graph);
  if (!cell?.isNode()) {
    centerDiagramContent(graph);
    ensureDiagramPaperContainsNodes(graph);
    return;
  }
  const box = cell.getBBox();
  const scroller = getDiagramScroller(graph);
  if (document.kind === "flowchart") {
    if (scroller) scroller.positionPoint({ x: box.x + box.width / 2, y: box.y }, "50%", 48);
    else graph.centerPoint(box.x + box.width / 2, box.y);
  } else if (policy.anchor === "leftmost") {
    const bounds = diagramNodeBounds(graph);
    const origin = bounds ?? { x: box.x, y: box.y, width: box.width, height: box.height };
    if (scroller) scroller.positionPoint({ x: origin.x, y: origin.y }, 40, 48);
    else graph.centerPoint(origin.x + origin.width / 2, origin.y);
  } else if (scroller) {
    scroller.centerPoint(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    graph.centerPoint(box.x + box.width / 2, box.y + box.height / 2);
  }
  ensureDiagramPaperContainsNodes(graph);
};

const fitDiagramContent = (
  graph: Graph,
  document: DiagramDocument,
  container: HTMLElement | null,
  padding = 32,
  viewport?: DiagramLayoutViewport,
) => {
  const policy = viewport ?? getDiagramLayoutViewport(document.kind);
  const bounds = diagramNodeBounds(graph);
  if (!bounds) return;
  ensureDiagramPaperContainsNodes(graph);
  const size = diagramViewportSize(graph, container);
  const minScale = policy.minScale ?? 1;
  if (size && !flowchartFitsReadableViewport(bounds, size, padding, minScale, policy.maxScale)) {
    readDiagramContent(graph, document);
    return;
  }
  // Fit every node, including mind-map branches left of the root. Zooming to a
  // visible subset or to edge paths lets Scroller shrink the paper and clip.
  fitDiagramRect(graph, bounds, { padding, maxScale: policy.maxScale });
  ensureDiagramPaperContainsNodes(graph);
};

const applyMindMapHierarchy = (graph: Graph, theme: DiagramTheme, appearance: DiagramAppearance, structure?: DiagramStructure) => {
  const palette = resolveDiagramPalette(theme, appearance);
  const nodes = graph.getNodes().map((node) => ({
    id: node.id,
    parentId: node.getData<NodeData>()?.parentId,
    ...node.getPosition(),
    ...node.getSize(),
  }));
  for (const node of graph.getNodes()) {
    const size = node.getSize();
    const { role, visual } = resolveMindMapNodeStyle(nodes, node.id, palette, theme, appearance, size, structure);
    node.setMarkup(mindMapTopicMarkup(structure, role));
    node.attr("body", visual.body);
    node.attr("underline", visual.underline);
    node.attr("label/fill", visual.label.fill);
    node.attr("label/fontSize", visual.label.fontSize);
    node.attr("label/fontWeight", visual.label.fontWeight);
    node.attr("label/fontFamily", visual.label.fontFamily);
    node.attr("label/lineHeight", visual.label.lineHeight);
    node.attr("label/refX", visual.label.refX ?? "50%");
    node.attr("label/refY", visual.label.refY);
    node.attr("label/textAnchor", visual.label.textAnchor);
    node.attr("label/textVerticalAnchor", visual.label.textVerticalAnchor);
  }
  for (const edge of graph.getEdges()) {
    const sourceId = edge.getSourceCellId();
    const targetId = edge.getTargetCellId();
    const source = nodes.find((node) => node.id === sourceId);
    const target = nodes.find((node) => node.id === targetId);
    if (!source || !target) continue;
    const sourceRole = mindMapNodeRole(nodes, source.id);
    const targetStyle = resolveMindMapNodeStyle(nodes, target.id, palette, theme, appearance, target, structure);
    const visual = mindMapEdgeVisual(sourceRole, palette, targetStyle.tint);
    const sides = mindMapBranchSides(source, target, structure);
    const sourceTerminal = mindMapEdgeTerminal(source, sourceRole, sides.source, structure);
    const targetTerminal = mindMapEdgeTerminal(target, targetStyle.role, sides.target, structure);
    const braceSpan = structure === "brace" ? mindMapSiblingSpan(nodes, sourceId) : null;
    const line = mindMapEdgeLineAttrs(structure, visual.stroke);
    edge.setSource({ cell: sourceId, ...sourceTerminal });
    edge.setTarget({ cell: targetId, ...targetTerminal });
    edge.setConnector(MIND_MAP_CONNECTOR_NAME, {
      sourceWidth: visual.sourceWidth,
      targetWidth: visual.targetWidth,
      structure,
      ...(braceSpan ? { braceTop: braceSpan.top, braceBottom: braceSpan.bottom } : {}),
    });
    edge.attr("line/stroke", visual.stroke);
    edge.attr("line/fill", line.fill);
    edge.attr("line/strokeWidth", line.strokeWidth);
    edge.attr("line/strokeLinejoin", line.strokeLinejoin);
    edge.attr("line/strokeLinecap", line.strokeLinecap);
    edge.attr("line/targetMarker", null);
    edge.attr("line/sourceMarker", null);
  }
};

const applyGraphPalette = (
  graph: Graph,
  theme: DiagramTheme,
  kind: DiagramDocument["kind"],
  appearance: DiagramAppearance,
  structure?: DiagramStructure,
) => {
  const palette = resolveDiagramPalette(theme, appearance);
  const scroller = getDiagramScroller(graph);
  scroller?.disableAutoResize();
  const historyEnabled = graph.isHistoryEnabled();
  if (historyEnabled) graph.disableHistory();
  try {
    for (const node of graph.getNodes()) {
      const data = node.getData<NodeData>();
      const shape = data?.shape ?? "process";
      refreshNodeLabel(node, data?.label ?? "", structure);
      const flowchartStyle = kind === "flowchart" ? flowchartNodeVisual(shape, appearance, node.getSize(), theme) : null;
      const architectureStyle = kind === "architecture"
        ? architectureNodeVisual(shape, appearance, node.getSize(), data?.resourceIcon)
        : null;
      const attrs = flowchartStyle
        ?? (architectureStyle ? { body: architectureStyle.body, label: architectureStyle.label } : null)
        ?? nodeAttrs(shape, theme, appearance, shape === "topic" && !data?.parentId);
      node.attr("body", attrs.body);
      node.attr("label", { ...attrs.label, text: node.attr("label/text") ?? data?.label ?? "" });
      if (architectureStyle) {
        for (const [selector, selectorAttrs] of Object.entries(architectureStyle.attrs)) {
          node.attr(selector, selectorAttrs as Record<string, string | number | undefined>);
        }
      }
      const flowchartSurface = kind === "flowchart" ? resolveFlowchartSurface(appearance, theme) : null;
      const architectureSurface = kind === "architecture" ? resolveArchitectureSurface(appearance) : null;
      for (const port of node.getPorts()) {
        if (!port.id) continue;
        node.portProp(port.id, "attrs/circle", {
          stroke: flowchartSurface?.terminator.stroke ?? architectureSurface?.nodes.service.stroke ?? palette.topicStroke,
          fill: flowchartSurface?.canvas ?? architectureSurface?.canvas ?? palette.canvas,
        });
      }
    }
    const flowchartSurface = kind === "flowchart" ? resolveFlowchartSurface(appearance, theme) : null;
    for (const edge of graph.getEdges()) {
      const edgeKind = edge.getData<EdgeData>()?.kind;
      const architectureEdge = kind === "architecture"
        ? architectureEdgeVisual(edgeKind, appearance, edge.getData<EdgeData>()?.bidirectional)
        : null;
      edge.attr("line/stroke", architectureEdge?.stroke ?? (kind === "mind-map" ? palette.mindMapEdge : flowchartSurface?.edge ?? palette.flowEdge));
      if (architectureEdge) {
        edge.attr("line/strokeWidth", architectureEdge.strokeWidth);
        edge.attr("line/strokeDasharray", architectureEdge.strokeDasharray);
        edge.attr("line/sourceMarker", architectureEdge.sourceMarker);
        edge.attr("line/targetMarker", architectureEdge.targetMarker);
      }
      if (kind !== "mind-map") edge.attr("line/fill", "none");
      if (edge.getLabels().length > 0) {
        edge.setLabels(edge.getLabels().map((label) => diagramEdgeLabel(String(label.attrs?.label?.text ?? ""), palette, kind, appearance, theme, edgeKind)));
      }
    }
    if (kind === "mind-map") applyMindMapHierarchy(graph, theme, appearance, structure);
    applyDiagramSurface(graph, theme, appearance, kind);
  } finally {
    if (historyEnabled) graph.enableHistory();
    scroller?.enableAutoResize();
    ensureDiagramPaperContainsNodes(graph);
  }
};

export const DiagramEditorPane = ({
  memo,
  notebooks,
  repository,
  readOnly,
  desktopFocusMode,
  onBackToList,
  onDeleted,
  onPermanentDeleted,
  onRestored,
  onSaved,
  onSaveAsTemplate,
  onToggleDesktopFocusMode,
  onOpenExecutionCenter,
  aiAssistantOpenToken,
  shortcutSettings,
  companionAvailable,
  beforeCompanionApply,
  onCompanionNotesChanged,
  onOpenCompanionNote,
}: DiagramEditorPaneProps) => {
  const { t } = useTranslation();
  const { resolvedTheme } = useAppearanceTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const scrollerResumeTimerRef = useRef<number | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const insertNodeRef = useRef<(relation: MindMapInsertRelation, baseNodeId?: string) => void>(() => undefined);
  const openFlowQuickCreateRef = useRef<(node: Node) => void>(() => undefined);
  const memoRef = useRef(memo);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const saveRef = useRef<() => void>(() => undefined);
  const document = parseDiagramDocument(memo.contentMarkdown);
  const denseArchitecture = document?.kind === "architecture"
    && document.edges.length >= 16
    && document.edges.length / Math.max(1, document.nodes.filter((node) => node.shape !== "boundary").length) >= 1.1;
  const documentTheme = document?.kind === "architecture"
    ? resolveDiagramTheme(document.theme ?? "brand")
    : document?.kind === "flowchart"
      ? resolveFlowchartTheme(document.theme)
      : resolveDiagramTheme(document?.theme);
  const documentStructure = resolveDiagramStructure(document?.structure);
  const [title, setTitle] = useState(memo.title ?? "");
  const [tagsText, setTagsText] = useState(memo.tags.join(", "));
  const [theme, setTheme] = useState<DiagramTheme>(documentTheme);
  const [structure, setStructure] = useState<DiagramStructure>(documentStructure);
  const titleRef = useRef(title);
  const tagsRef = useRef(tagsText);
  const themeRef = useRef<DiagramTheme>(documentTheme);
  const structureRef = useRef<DiagramStructure>(documentStructure);
  const appearanceRef = useRef<DiagramAppearance>(resolvedTheme);
  const savedSnapshotRef = useRef(document ? diagramEditorSnapshot(memo.title ?? "", document) : "");
  const viewOnlyRef = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeLabel, setSelectedNodeLabel] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedEdgeLabel, setSelectedEdgeLabel] = useState("");
  const [hasSelection, setHasSelection] = useState(false);
  const [showAllArchitectureLabels, setShowAllArchitectureLabels] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tagsDirty, setTagsDirty] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const [graphReloadVersion, setGraphReloadVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editSessionReady, setEditSessionReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpenState] = useState(readAiSidebarOpen);
  const setAiSidebarOpen = useCallback((open: boolean) => {
    setAiAssistantOpenState(open);
    writeAiSidebarOpen(open);
  }, []);
  const handledAiAssistantOpenTokenRef = useRef(aiAssistantOpenToken);
  const [memoIdCopyNotice, setMemoIdCopyNotice] = useState<"copied" | "error" | null>(null);
  const memoIdCopyTimerRef = useRef<number | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [mobileNotebookSheetOpen, setMobileNotebookSheetOpen] = useState(false);
  const [headerTitleSlot, setHeaderTitleSlot] = useState<HTMLDivElement | null>(null);
  const [headerStatusCluster, setHeaderStatusCluster] = useState<HTMLDivElement | null>(null);
  const [titleStatusClearancePx, setTitleStatusClearancePx] = useState(0);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [shiftSelectActive, setShiftSelectActive] = useState(false);
  const spacePanActiveRef = useRef(false);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [nodeEditor, setNodeEditor] = useState<NodeEditorState | null>(null);
  const [flowQuickCreate, setFlowQuickCreate] = useState<FlowQuickCreateState | null>(null);
  const [pendingArchitectureItem, setPendingArchitectureItem] = useState<ArchitectureLibraryItem | null>(null);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const flowQuickCreateRef = useRef<FlowQuickCreateState | null>(null);
  const flowPointerDragRef = useRef<FlowPointerDragState | null>(null);
  const nodeEditorRef = useRef<NodeEditorState | null>(null);
  const editorDirty = dirty || tagsDirty;

  spacePanActiveRef.current = spacePanActive;

  useEffect(() => {
    setPendingArchitectureItem(null);
  }, [memo.id]);

  useEffect(() => {
    const isTextInput = (target: EventTarget | null) => target instanceof HTMLElement
      && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const handleCanvasKeyDown = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) return;
      if (event.key === "Shift") setShiftSelectActive(true);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code !== "Space" || !(event.target instanceof globalThis.Node) || !containerRef.current?.contains(event.target)) return;
      event.preventDefault();
      setSpacePanActive(true);
    };
    const handleCanvasKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftSelectActive(false);
      if (event.code === "Space") setSpacePanActive(false);
    };
    const releaseTemporaryPan = () => {
      setShiftSelectActive(false);
      setSpacePanActive(false);
    };
    window.addEventListener("keydown", handleCanvasKeyDown);
    window.addEventListener("keyup", handleCanvasKeyUp);
    window.addEventListener("blur", releaseTemporaryPan);
    return () => {
      window.removeEventListener("keydown", handleCanvasKeyDown);
      window.removeEventListener("keyup", handleCanvasKeyUp);
      window.removeEventListener("blur", releaseTemporaryPan);
    };
  }, []);

  useEffect(() => {
    if (!pendingArchitectureItem) return;
    const cancelPlacement = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPendingArchitectureItem(null);
    };
    window.addEventListener("keydown", cancelPlacement);
    return () => window.removeEventListener("keydown", cancelPlacement);
  }, [pendingArchitectureItem]);

  const beginNodeEdit = useCallback((node: Node) => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;
    const nextEditor = nodeEditorState(graph, node, themeRef.current, appearanceRef.current, canvasSurfaceRef.current);
    nodeEditorRef.current = nextEditor;
    setNodeEditor(nextEditor);
  }, [readOnly]);

  const finishNodeEdit = useCallback((cancel = false) => {
    const graph = graphRef.current;
    const current = nodeEditorRef.current;
    nodeEditorRef.current = null;
    setNodeEditor(null);
    if (!graph || !current) return null;
    const cell = graph.getCellById(current.nodeId);
    if (!cell?.isNode()) return null;
    if (!cancel) {
      const label = current.value.trim() || current.originalValue;
      if (label !== current.originalValue) {
        graph.startBatch("edit-label");
        cell.setData({ ...cell.getData<NodeData>(), label });
        refreshNodeLabel(cell, label, structureRef.current);
        if (cell.getData<NodeData>()?.shape === "topic") {
          applyMindMapHierarchy(graph, themeRef.current, appearanceRef.current, structureRef.current);
        }
        graph.stopBatch("edit-label");
        setSelectedNodeLabel(label);
      }
    }
    containerRef.current?.focus({ preventScroll: true });
    return cell;
  }, []);

  const dismissFlowQuickCreate = useCallback(() => {
    const pending = flowQuickCreateRef.current;
    flowQuickCreateRef.current = null;
    setFlowQuickCreate(null);
    if (!pending) return;
    const graph = graphRef.current;
    const draftEdge = graph?.getCellById(pending.draftEdgeId);
    if (graph && draftEdge?.isEdge()) removeFlowDraftEdge(graph, draftEdge, pending.restoreHistory);
    if (graph && pending.restoreHistory) graph.enableHistory();
  }, []);

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedNodeLabel("");
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(false);
    flowQuickCreateRef.current = null;
    setFlowQuickCreate(null);
    nodeEditorRef.current = null;
    setNodeEditor(null);
    setTheme(documentTheme);
    themeRef.current = documentTheme;
    setStructure(documentStructure);
    structureRef.current = documentStructure;
    setHistoryOpen(false);
    setShareOpen(false);
    setMemoIdCopyNotice(null);
  }, [documentStructure, documentTheme, memo.id]);

  useEffect(() => () => {
    if (memoIdCopyTimerRef.current !== null) window.clearTimeout(memoIdCopyTimerRef.current);
  }, []);

  useEffect(() => {
    memoRef.current = memo;
    setTitle(memo.title ?? "");
    titleRef.current = memo.title ?? "";
    setTagsText(memo.tags.join(", "));
    tagsRef.current = memo.tags.join(", ");
    savedSnapshotRef.current = document ? diagramEditorSnapshot(memo.title ?? "", document) : "";
    setDirty(false);
    setTagsDirty(false);
    setMobileNotebookSheetOpen(false);
    setSaveError(null);
    setSaveFailed(false);
    editSessionRef.current = null;
    setEditSessionReady(false);
    if (readOnly || isLocalMemoId(memo.id) || isBrowserOffline() || window.edgeeverDesktop?.isAvailable) {
      editSessionRef.current = createLocalEditSession(memo);
      setEditSessionReady(true);
      return;
    }
    let cancelled = false;
    void api.createMemoEditSession(memo.id).then(({ editSession }) => {
      if (!cancelled) {
        editSessionRef.current = editSession;
        setEditSessionReady(true);
      }
    }).catch(() => {
      if (!cancelled) setSaveError(t("diagram.editSessionError"));
    });
    return () => { cancelled = true; };
  }, [memo.id, memo.contentHash, memo.revision, readOnly, t]);

  useEffect(() => {
    if (handledAiAssistantOpenTokenRef.current === aiAssistantOpenToken) return;
    handledAiAssistantOpenTokenRef.current = aiAssistantOpenToken;
    if (readOnly || historyOpen || shareOpen || confirmDiscardOpen || mobileNotebookSheetOpen) return;
    setAiSidebarOpen(true);
    if (editorDirty) saveRef.current();
  }, [aiAssistantOpenToken, confirmDiscardOpen, editorDirty, historyOpen, mobileNotebookSheetOpen, readOnly, setAiSidebarOpen, shareOpen]);

  useEffect(() => {
    appearanceRef.current = resolvedTheme;
    const graph = graphRef.current;
    if (!graph || !document) return;
    viewOnlyRef.current = true;
    try {
      applyGraphPalette(graph, themeRef.current, document.kind, resolvedTheme, structureRef.current);
    } finally {
      viewOnlyRef.current = false;
    }
    const currentEditor = nodeEditorRef.current;
    if (!currentEditor) return;
    const node = graph.getCellById(currentEditor.nodeId);
    if (!node?.isNode()) return;
    const visualState = nodeEditorState(graph, node, themeRef.current, resolvedTheme, canvasSurfaceRef.current);
    const nextEditor = {
      ...currentEditor,
      color: visualState.color,
      background: visualState.background,
      borderColor: visualState.borderColor,
    };
    nodeEditorRef.current = nextEditor;
    setNodeEditor(nextEditor);
  }, [resolvedTheme, document?.kind]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !document) return;
    const incomingSnapshot = diagramEditorSnapshot(memo.title ?? "", document);
    const canvasSnapshot = diagramEditorSnapshot(
      titleRef.current,
      graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
    );
    if (incomingSnapshot !== canvasSnapshot) {
      setGraphReloadVersion((current) => current + 1);
    }
  }, [memo.contentHash]);

  useEffect(() => {
    if (!containerRef.current || !document) return;
    const appearance = appearanceRef.current;
    const palette = resolveDiagramPalette(documentTheme, appearance);
    let graph!: Graph;
    graph = new Graph({
      container: containerRef.current,
      autoResize: true,
      async: true,
      grid: document.kind === "architecture" ? {
        size: 20,
        visible: true,
        type: "dot",
        args: {
          color: appearance === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.08)",
          thickness: 1.2,
        },
      } : false,
      panning: false,
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: DIAGRAM_ZOOM_SCALE_MIN, maxScale: DIAGRAM_ZOOM_SCALE_MAX },
      interacting: () => !readOnly && !spacePanActiveRef.current,
      connecting: {
        // The port's transparent hit area is larger than the visible node.
        // Connect to its center so arrowheads reach the node border.
        connectionPoint: document.kind === "architecture" ? "anchor" : "boundary",
        allowBlank: document.kind === "flowchart",
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        allowPort: isConnectableDiagram(document.kind),
        allowMulti: false,
        highlight: isConnectableDiagram(document.kind),
        snap: { radius: 24 },
        router: document.kind === "architecture"
          ? architectureEdgeRouter("", "", [])
          : usesOrthogonalDiagramEdges(document.kind) ? FLOWCHART_EDGE_ROUTER : "normal",
        connector: document.kind === "mind-map" ? MIND_MAP_CONNECTOR_NAME : "rounded",
        validateConnection: ({ sourceCell, targetCell, sourcePort, targetPort }) => {
          if (!isConnectableDiagram(document.kind) || !sourceCell || !sourcePort) return false;
          if (!targetCell) return true;
          return Boolean(targetPort && sourceCell.id !== targetCell.id);
        },
        createEdge: (): Edge => {
          dismissFlowQuickCreate();
          const restoreHistory = graph.isHistoryEnabled();
          if (restoreHistory) graph.disableHistory();
          return graph.createEdge({
            ...edgeMetadata(
              { id: createId("edge"), source: "", target: "" },
              document.kind,
              themeRef.current,
              appearanceRef.current,
            ),
            data: { quickConnectDraft: true, restoreHistory },
          });
        },
      },
    });
    graph.use(new Scroller({
      enabled: true,
      autoResize: true,
      padding: 32,
      pannable: { enabled: true, eventTypes: ["leftMouseDown", "rightMouseDown"] },
      className: "edgeever-diagram-scroller",
    }));
    bindDiagramScrollerFit(graph);
    graphRef.current = graph;
    graph.use(new History({ enabled: !readOnly }));
    graph.use(new Export());
    graph.use(new Keyboard({
      enabled: !readOnly,
      global: false,
      guard: (event) => {
        const target = event.target;
        return !(target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));
      },
    }));
    graph.use(new Selection({
      enabled: true,
      multiple: true,
      multipleSelectionModifiers: ["ctrl", "meta", "shift"],
      rubberband: true,
      modifiers: "shift",
      movable: !readOnly,
      showNodeSelectionBox: true,
      showEdgeSelectionBox: true,
    }));
    let relationHover: { type: "node" | "edge"; id: string } | null = null;
    let relationSelection: { type: "node" | "edge"; id: string } | null = null;
    const refreshRelationFocus = () => {
      if (document.kind === "architecture") {
        focusArchitectureRelations(graph, containerRef.current, relationHover ?? relationSelection);
      }
    };
    if (document.kind === "architecture") {
      graph.on("render:done", refreshRelationFocus);
    }
    graph.addNodes(document.nodes.map((node) => {
      const inferredResourceIcon = document.kind === "architecture" && !node.resourceIcon
        ? inferArchitectureResourceIcon(node.label, t)
        : undefined;
      return nodeMetadata({
        ...node,
        ...(inferredResourceIcon ? { resourceIcon: inferredResourceIcon } : {}),
      }, documentTheme, document.kind, appearance, documentStructure);
    }));
    if (document.kind === "architecture") {
      for (const node of graph.getNodes()) {
        const parentId = node.getData<NodeData>()?.parentId;
        const parent = parentId ? graph.getCellById(parentId) : null;
        if (parent?.isNode()) parent.addChild(node);
      }
    }
    graph.addEdges(document.edges.map((edge) => edgeMetadata(edge, document.kind, documentTheme, appearance, documentStructure)));
    if (usesOrthogonalDiagramEdges(document.kind)) applyOrthogonalEdgePorts(graph, document.kind);
    if (document.kind === "architecture") {
      graph.on("node:mouseenter", ({ node }: { node: Node }) => {
        if (node.getData<NodeData>()?.shape === "boundary") return;
        relationHover = { type: "node", id: node.id };
        refreshRelationFocus();
      });
      graph.on("node:mouseleave", ({ node }: { node: Node }) => {
        if (relationHover?.type === "node" && relationHover.id === node.id) relationHover = null;
        refreshRelationFocus();
      });
      graph.on("edge:mouseenter", ({ edge }: { edge: Edge }) => {
        relationHover = { type: "edge", id: edge.id };
        refreshRelationFocus();
      });
      graph.on("edge:mouseleave", ({ edge }: { edge: Edge }) => {
        if (relationHover?.type === "edge" && relationHover.id === edge.id) relationHover = null;
        refreshRelationFocus();
      });
    }
    applyGraphPalette(graph, documentTheme, document.kind, appearance, documentStructure);
    graph.on("scale", () => setZoomPercent(Math.round(graph.scale().sx * 100)));
    graph.cleanHistory();
    const scroller = getDiagramScroller(graph);
    scroller?.disableAutoResize();
    const settleLoadedViewport = () => {
      if (graphRef.current !== graph) return false;
      if (!diagramCanvasIsReady(canvasSurfaceRef.current)) return false;
      ensureDiagramPaperContainsNodes(graph);
      fitDiagramContent(graph, document, containerRef.current, 32);
      return true;
    };
    settleLoadedViewport();
    graph.once("render:done", settleLoadedViewport);
    const loadFitFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => settleLoadedViewport());
    });
    const canvasSurface = canvasSurfaceRef.current;
    let loadFitObserver: ResizeObserver | null = null;
    if (canvasSurface) {
      loadFitObserver = new ResizeObserver(() => {
        if (settleLoadedViewport()) loadFitObserver?.disconnect();
      });
      loadFitObserver.observe(canvasSurface);
    }
    const loadFitTimer = window.setTimeout(() => {
      if (graphRef.current !== graph) return;
      loadFitObserver?.disconnect();
      scroller?.enableAutoResize();
      scroller?.updateScroller();
      settleLoadedViewport();
    }, SCROLLER_AUTORESIZE_SETTLE_MS);

    const updateHistory = () => setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    const refreshArchitecturePorts = () => {
      if (document.kind !== "architecture") return;
      const historyEnabled = graph.isHistoryEnabled();
      if (historyEnabled) graph.disableHistory();
      try {
        applyOrthogonalEdgePorts(graph, document.kind);
      } finally {
        if (historyEnabled) graph.enableHistory();
      }
    };
    const markDirty = () => {
      if (viewOnlyRef.current) return;
      if (!readOnly) {
        const currentDocument = graphToDocument(graph, document.kind, themeRef.current, structureRef.current);
        const hasChanges = savedSnapshotRef.current !== diagramEditorSnapshot(titleRef.current, currentDocument);
        setDirty(hasChanges);
        if (hasChanges) setDirtyVersion((current) => current + 1);
      }
      updateHistory();
    };
    const clearSelectionAfterHistory = () => {
      relationSelection = null;
      relationHover = null;
      refreshRelationFocus();
      refreshArchitecturePorts();
      applyGraphPalette(graph, themeRef.current, document.kind, appearanceRef.current, structureRef.current);
      graph.cleanSelection();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph);
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      ));
    };
    graph.on("model:updated", markDirty);
    graph.on("history:change", updateHistory);
    graph.on("history:undo", clearSelectionAfterHistory);
    graph.on("history:redo", clearSelectionAfterHistory);
    graph.on("node:selected", ({ node }: { node: Node }) => {
      if (isConnectableDiagram(document.kind)) setFlowNodePortsActive(graph, node, true);
    });
    graph.on("node:unselected", ({ node }: { node: Node }) => {
      if (isConnectableDiagram(document.kind)) setFlowNodePortsActive(graph, node, false);
    });
    graph.on("node:click", ({ node }: { node: Node }) => {
      const data = node.getData<NodeData>();
      relationSelection = document.kind === "architecture" && data?.shape !== "boundary"
        ? { type: "node", id: node.id }
        : null;
      refreshRelationFocus();
      dismissFlowQuickCreate();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph, node);
      containerRef.current?.focus({ preventScroll: true });
      setSelectedNodeId(node.id);
      setSelectedNodeLabel(data?.label ?? "");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(true);
    });
    graph.on("node:dblclick", ({ node }: { node: Node }) => beginNodeEdit(node));
    graph.on("node:mouseup", () => {
      if (document.kind === "architecture") {
        refreshArchitecturePorts();
        return;
      }
      if (document.kind !== "mind-map") return;
      const historyEnabled = graph.isHistoryEnabled();
      if (historyEnabled) graph.disableHistory();
      try {
        applyMindMapHierarchy(graph, themeRef.current, appearanceRef.current, structureRef.current);
      } finally {
        if (historyEnabled) graph.enableHistory();
      }
    });
    graph.on("edge:click", ({ edge }: { edge: Edge }) => {
      relationSelection = { type: "edge", id: edge.id };
      refreshRelationFocus();
      dismissFlowQuickCreate();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph);
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(edge.id);
      setSelectedEdgeLabel(String(edge.getLabels()[0]?.attrs?.label?.text ?? ""));
      setHasSelection(true);
    });
    graph.on("blank:click", () => {
      relationSelection = null;
      relationHover = null;
      refreshRelationFocus();
      dismissFlowQuickCreate();
      if (isConnectableDiagram(document.kind)) setOnlyFlowNodePortsActive(graph);
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
    });
    graph.on("edge:removed", ({ edge }: { edge: Edge }) => {
      if (relationSelection?.type === "edge" && relationSelection.id === edge.id) relationSelection = null;
      if (relationHover?.type === "edge" && relationHover.id === edge.id) relationHover = null;
      refreshRelationFocus();
      const draft = edge.getData<{ quickConnectDraft?: boolean; restoreHistory?: boolean }>();
      if (flowQuickCreateRef.current?.draftEdgeId === edge.id) {
        flowQuickCreateRef.current = null;
        setFlowQuickCreate(null);
      }
      if (draft?.quickConnectDraft && draft.restoreHistory) graph.enableHistory();
    });
    graph.on("node:removed", ({ node }: { node: Node }) => {
      if (relationSelection?.type === "node" && relationSelection.id === node.id) relationSelection = null;
      if (relationHover?.type === "node" && relationHover.id === node.id) relationHover = null;
      refreshRelationFocus();
    });
    const showFlowQuickCreate = (
      edge: Edge,
      sourceNodeId: string,
      sourcePort: FlowPort | undefined,
      point: { x: number; y: number },
      restoreHistory: boolean,
    ) => {
      if (!containerRef.current) return;
      const overlayPoint = graph.localToGraph(point);
      const nextQuickCreate: FlowQuickCreateState = {
        draftEdgeId: edge.id,
        restoreHistory,
        sourceNodeId,
        sourcePort,
        x: point.x,
        y: point.y,
        left: Math.max(12, Math.min(overlayPoint.x + 12, containerRef.current.clientWidth - FLOW_QUICK_CREATE_WIDTH - 12)),
        top: Math.max(12, Math.min(overlayPoint.y + 12, containerRef.current.clientHeight - FLOW_QUICK_CREATE_HEIGHT - 12)),
      };
      flowQuickCreateRef.current = nextQuickCreate;
      setFlowQuickCreate(nextQuickCreate);
      if (restoreHistory) graph.enableHistory();
    };
    const openFlowQuickCreate = (sourceNode: Node) => {
      dismissFlowQuickCreate();
      const sourceBounds = sourceNode.getBBox();
      const nextSize = compactFlowchartNodeSize("process");
      const sourcePort: FlowPort = "right";
      const point = {
        x: sourceBounds.x + sourceBounds.width + 96 + nextSize.width / 2,
        y: sourceBounds.y + sourceBounds.height / 2,
      };
      const restoreHistory = graph.isHistoryEnabled();
      if (restoreHistory) graph.disableHistory();
      const draftEdge = graph.addEdge({
        ...edgeMetadata(
          { id: createId("edge"), source: sourceNode.id, target: "" },
          document.kind,
          themeRef.current,
          appearanceRef.current,
        ),
        source: { cell: sourceNode.id, port: sourcePort },
        target: point,
        data: { quickConnectDraft: true, restoreHistory },
      });
      showFlowQuickCreate(draftEdge, sourceNode.id, sourcePort, point, restoreHistory);
    };
    openFlowQuickCreateRef.current = openFlowQuickCreate;
    graph.on("edge:connected", ({ edge, isNew, type, currentCell, currentPort, currentPoint }) => {
      if (!isConnectableDiagram(document.kind) || !isNew || type !== "target") return;
      const sourceNodeId = edge.getSourceCellId();
      const source = edge.getSource();
      const draft = edge.getData<{ restoreHistory?: boolean }>();
      const removeDraft = () => {
        graph.removeCell(edge);
        if (draft?.restoreHistory) graph.enableHistory();
      };
      if (!sourceNodeId) {
        removeDraft();
        return;
      }
      if (currentCell?.isNode()) {
        removeDraft();
        graph.startBatch("connect");
        graph.addEdge({
          ...edgeMetadata(
            { id: edge.id, source: sourceNodeId, target: currentCell.id },
            document.kind,
            themeRef.current,
            appearanceRef.current,
          ),
          source,
          target: { cell: currentCell.id, ...(currentPort ? { port: currentPort } : {}) },
        });
        graph.stopBatch("connect");
        if (usesOrthogonalDiagramEdges(document.kind)) applyOrthogonalEdgePorts(graph, document.kind);
        return;
      }
      if (!currentPoint || !containerRef.current) {
        removeDraft();
        return;
      }
      showFlowQuickCreate(
        edge,
        sourceNodeId,
        "port" in source && typeof source.port === "string" ? source.port as FlowPort : undefined,
        currentPoint,
        Boolean(draft?.restoreHistory),
      );
    });
    const handleFlowPointerDown = (event: PointerEvent) => {
      if (document.kind !== "flowchart" || readOnly || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const port = target?.closest(".x6-port-body");
      const node = target?.closest(".x6-node");
      const sourcePort = port?.getAttribute("port") as FlowPort | null;
      const sourceNodeId = node?.getAttribute("data-cell-id");
      if (!sourcePort || !sourceNodeId) return;
      flowPointerDragRef.current = {
        sourceNodeId,
        sourcePort,
        startClientX: event.clientX,
        startClientY: event.clientY,
      };
    };
    const handleFlowPointerUp = (event: PointerEvent) => {
      const pointerDrag = flowPointerDragRef.current;
      flowPointerDragRef.current = null;
      if (!pointerDrag || document.kind !== "flowchart" || readOnly) return;
      if (Math.hypot(event.clientX - pointerDrag.startClientX, event.clientY - pointerDrag.startClientY) < 8) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".x6-port-body") || target?.closest(".x6-node")) return;
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      const clientPoint = { x: event.clientX, y: event.clientY };
      window.setTimeout(() => {
        if (graphRef.current !== graph || flowQuickCreateRef.current) return;
        const point = graph.clientToLocal(clientPoint);
        const existingDraft = graph.getEdges().find((candidate) => candidate.getData<{ quickConnectDraft?: boolean }>()?.quickConnectDraft);
        const restoreHistory = existingDraft
          ? Boolean(existingDraft.getData<{ restoreHistory?: boolean }>()?.restoreHistory)
          : graph.isHistoryEnabled();
        if (!existingDraft && restoreHistory) graph.disableHistory();
        const draftEdge = existingDraft ?? graph.addEdge({
          ...edgeMetadata(
            { id: createId("edge"), source: pointerDrag.sourceNodeId, target: "" },
            document.kind,
            themeRef.current,
            appearanceRef.current,
          ),
          source: { cell: pointerDrag.sourceNodeId, port: pointerDrag.sourcePort },
          target: point,
          data: { quickConnectDraft: true, restoreHistory },
        });
        showFlowQuickCreate(draftEdge, pointerDrag.sourceNodeId, pointerDrag.sourcePort, point, restoreHistory);
      }, 0);
    };
    containerRef.current.addEventListener("pointerdown", handleFlowPointerDown, true);
    window.addEventListener("pointerup", handleFlowPointerUp, true);
    graph.bindKey(["backspace", "delete"], (event) => {
      event.preventDefault();
      if (!removeGraphSelection(graph)) return;
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      ));
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    });
    graph.bindKey("enter", (event) => {
      event.preventDefault();
      const selected = graph.getSelectedCells().find((cell) => cell.isNode());
      if (document.kind === "mind-map") {
        insertNodeRef.current("sibling", selected?.id);
      } else if (selected?.isNode()) {
        beginNodeEdit(selected);
      }
    });
    graph.bindKey("tab", (event) => {
      event.preventDefault();
      const selected = graph.getSelectedCells().find((cell) => cell.isNode());
      if (document.kind === "mind-map") {
        insertNodeRef.current("child", selected?.id);
      } else if (document.kind === "flowchart" && selected?.isNode()) {
        openFlowQuickCreate(selected);
      }
    });
    if (isConnectableDiagram(document.kind)) {
      graph.bindKey(["meta+d", "ctrl+d"], (event) => {
        event.preventDefault();
        const selectedNodes = graph.getSelectedCells().filter((cell): cell is Node => cell.isNode());
        if (selectedNodes.length === 0) return;
        graph.startBatch("duplicate");
        const duplicates = selectedNodes.map((node) => {
          const data = node.getData<NodeData>();
          const position = node.getPosition();
          const duplicate = graph.addNode(nodeMetadata({
            id: createId("node"),
            label: data?.label ?? (document.kind === "architecture" ? t("diagram.newService") : t("diagram.newStep")),
            x: position.x + 24,
            y: position.y + 24,
            width: node.getSize().width,
            height: node.getSize().height,
            shape: data?.shape ?? "process",
            ...(data?.parentId ? { parentId: data.parentId } : {}),
            ...(data?.resourceIcon ? { resourceIcon: data.resourceIcon } : {}),
          }, themeRef.current, document.kind, appearanceRef.current, structureRef.current));
          const parent = data?.parentId ? graph.getCellById(data.parentId) : null;
          if (parent?.isNode()) parent.addChild(duplicate);
          return duplicate;
        });
        graph.stopBatch("duplicate");
        graph.cleanSelection();
        duplicates.forEach((node) => graph.select(node));
        const lastNode = duplicates.at(-1);
        setSelectedNodeId(lastNode?.id ?? null);
        setSelectedNodeLabel(lastNode?.getData<NodeData>()?.label ?? "");
        setHasSelection(duplicates.length > 0);
      });
    }
    const nudgeSelection = (event: KeyboardEvent) => {
      const selectedNodes = graph.getSelectedCells().filter((cell): cell is Node => cell.isNode());
      if (selectedNodes.length === 0) return;
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      const movement = {
        ArrowUp: { dx: 0, dy: -distance },
        ArrowDown: { dx: 0, dy: distance },
        ArrowLeft: { dx: -distance, dy: 0 },
        ArrowRight: { dx: distance, dy: 0 },
      }[event.key];
      if (!movement) return;
      graph.startBatch("nudge");
      selectedNodes.forEach((node) => node.translate(movement.dx, movement.dy));
      graph.stopBatch("nudge");
    };
    graph.bindKey(["up", "down", "left", "right", "shift+up", "shift+down", "shift+left", "shift+right"], nudgeSelection);
    graph.bindKey("0", (event) => {
      event.preventDefault();
      fitDiagramContent(graph, document, containerRef.current);
    });
    graph.bindKey("1", (event) => {
      event.preventDefault();
      ensureDiagramPaperContainsNodes(graph);
      zoomDiagram(graph, 1, true);
      ensureDiagramPaperContainsNodes(graph);
      centerDiagramContent(graph);
    });
    graph.bindKey("esc", (event) => {
      if (!flowQuickCreateRef.current) return;
      event.preventDefault();
      dismissFlowQuickCreate();
    });
    graph.bindKey(["meta+z", "ctrl+z"], (event) => {
      event.preventDefault();
      graph.undo();
      applyGraphPalette(graph, themeRef.current, document.kind, appearanceRef.current, structureRef.current);
      graph.cleanSelection();
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      ));
    });
    graph.bindKey(["meta+shift+z", "ctrl+shift+z", "ctrl+y"], (event) => {
      event.preventDefault();
      graph.redo();
      applyGraphPalette(graph, themeRef.current, document.kind, appearanceRef.current, structureRef.current);
      graph.cleanSelection();
      setSelectedNodeId(null);
      setSelectedNodeLabel("");
      setSelectedEdgeId(null);
      setSelectedEdgeLabel("");
      setHasSelection(false);
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      ));
    });
    return () => {
      if (containerRef.current) delete containerRef.current.dataset.relationsFocused;
      containerRef.current?.removeEventListener("pointerdown", handleFlowPointerDown, true);
      window.removeEventListener("pointerup", handleFlowPointerUp, true);
      flowPointerDragRef.current = null;
      openFlowQuickCreateRef.current = () => undefined;
      nodeEditorRef.current = null;
      loadFitObserver?.disconnect();
      window.clearTimeout(loadFitTimer);
      window.cancelAnimationFrame(loadFitFrame);
      if (scrollerResumeTimerRef.current !== null) {
        window.clearTimeout(scrollerResumeTimerRef.current);
        scrollerResumeTimerRef.current = null;
      }
      graphRef.current = null;
      graph.dispose();
    };
  }, [beginNodeEdit, dismissFlowQuickCreate, graphReloadVersion, memo.id, readOnly]);

  useEffect(() => {
    if (!editorDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editorDirty]);

  useEffect(() => {
    if (readOnly) return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [readOnly]);

  const addNode = useCallback((
    shape: DiagramNodeShape = "process",
    options: {
      relation?: MindMapInsertRelation;
      baseNodeId?: string;
      beginEditing?: boolean;
      label?: string;
      position?: { x: number; y: number };
      resourceIcon?: ArchitectureResourceIcon;
    } = {},
  ) => {
    const graph = graphRef.current;
    if (!graph || !document || readOnly) return;
    const isMindMap = document.kind === "mind-map";
    const settleScroller = suspendScrollerAutoResize(
      graph,
      scrollerResumeTimerRef,
      () => graphRef.current === graph,
      { restoreAnchor: !isMindMap },
    );
    const baseNodeId = options.baseNodeId ?? selectedNodeId;
    const selected = baseNodeId
      ? graph.getCellById(baseNodeId) as Node | undefined
      : isMindMap
        ? graph.getNodes()[0]
        : undefined;
    const selectedPosition = selected?.isNode() ? selected.getPosition() : { x: 120, y: 120 };
    const selectedSize = selected?.isNode() ? selected.getSize() : { width: 140, height: 52 };
    const isArchitecture = document.kind === "architecture";
    const selectedData = selected?.isNode() ? selected.getData<NodeData>() : undefined;
    const requestedSibling = isMindMap && options.relation === "sibling" && Boolean(selectedData?.parentId);
    const parent = requestedSibling
      ? graph.getCellById(selectedData?.parentId ?? "") as Node | undefined
      : selected;
    const siblings = requestedSibling
      ? graph.getNodes().filter((node) => node.getData<NodeData>()?.parentId === selectedData?.parentId)
      : [];
    const childNodes = isMindMap && selected?.isNode()
      ? graph.getNodes().filter((node) => node.getData<NodeData>()?.parentId === selected.id)
      : [];
    const authoredSize = isArchitecture
      ? compactArchitectureNodeSize(shape)
      : { width: shape === "decision" ? 132 : 140, height: shape === "decision" ? 84 : 52 };
    const dropBoundary = isArchitecture && shape !== "boundary" && options.position
      ? graph.getNodes()
        .filter((node) => node.getData<NodeData>()?.shape === "boundary")
        .filter((node) => {
          const bounds = node.getBBox();
          return options.position!.x >= bounds.x
            && options.position!.x <= bounds.x + bounds.width
            && options.position!.y >= bounds.y
            && options.position!.y <= bounds.y + bounds.height;
        })
        .sort((left, right) => {
          const leftBounds = left.getBBox();
          const rightBounds = right.getBBox();
          return leftBounds.width * leftBounds.height - rightBounds.width * rightBounds.height;
        })[0]
      : undefined;
    const requestedPosition = options.position
      ? {
          x: options.position.x - authoredSize.width / 2,
          y: options.position.y - authoredSize.height / 2,
        }
      : undefined;
    if (requestedPosition && dropBoundary) {
      const bounds = dropBoundary.getBBox();
      const horizontalPadding = 18;
      const topPadding = 40;
      const bottomPadding = 18;
      requestedPosition.x = Math.min(
        Math.max(requestedPosition.x, bounds.x + horizontalPadding),
        Math.max(bounds.x + horizontalPadding, bounds.x + bounds.width - authoredSize.width - horizontalPadding),
      );
      requestedPosition.y = Math.min(
        Math.max(requestedPosition.y, bounds.y + topPadding),
        Math.max(bounds.y + topPadding, bounds.y + bounds.height - authoredSize.height - bottomPadding),
      );
    }
    const nextPosition = requestedPosition ?? (requestedSibling
      ? {
          x: selectedPosition.x,
          y: Math.max(selectedPosition.y, ...siblings.map((node) => node.getPosition().y))
            + selectedSize.height + (isMindMap ? MIND_MAP_VERTICAL_GAP : 16),
        }
      : {
          x: selectedPosition.x + selectedSize.width + (isMindMap ? MIND_MAP_HORIZONTAL_GAP : 110),
          y: childNodes.length > 0
            ? Math.max(...childNodes.map((node) => node.getPosition().y))
              + selectedSize.height + (isMindMap ? MIND_MAP_VERTICAL_GAP : 16)
            : selectedPosition.y,
        });
    const id = createId(isMindMap ? "topic" : "node");
    const architectureParentId = isArchitecture && shape !== "boundary"
      ? dropBoundary?.id ?? (options.position ? undefined : selectedData?.shape === "boundary" ? selected?.id : selectedData?.parentId)
      : undefined;
    graph.startBatch("add");
    const node = graph.addNode(nodeMetadata({
      id,
      label: options.label ?? (isMindMap ? t("diagram.newTopic") : isArchitecture ? architectureNodeLabel(shape, t) : t("diagram.newStep")),
      x: nextPosition.x,
      y: nextPosition.y,
      width: authoredSize.width,
      height: authoredSize.height,
      shape: isMindMap ? "topic" : shape,
      ...(isMindMap && parent?.isNode() ? { parentId: parent.id } : {}),
      ...(architectureParentId ? { parentId: architectureParentId } : {}),
      ...(isArchitecture && options.resourceIcon ? { resourceIcon: options.resourceIcon } : {}),
    }, themeRef.current, document.kind, appearanceRef.current, structureRef.current));
    if (architectureParentId) {
      const architectureParent = graph.getCellById(architectureParentId);
      if (architectureParent?.isNode()) architectureParent.addChild(node);
    }
    if (isMindMap && parent?.isNode()) {
      graph.addEdge(edgeMetadata(
        { id: createId("branch"), source: parent.id, target: id },
        document.kind,
        themeRef.current,
        appearanceRef.current,
        structureRef.current,
      ));
    }
    if (isMindMap) {
      const positions = computeDiagramLayout(
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
        requestedSibling && selected?.isNode()
          ? { insertedNodeId: id, insertAfterNodeId: selected.id }
          : {},
      );
      for (const graphNode of graph.getNodes()) {
        const position = positions[graphNode.id];
        if (position) graphNode.position(position.x, position.y);
      }
      applyMindMapHierarchy(graph, themeRef.current, appearanceRef.current, structureRef.current);
    }
    graph.stopBatch("add");
    settleScroller();
    if (isMindMap) revealDiagramNode(graph, node);
    graph.cleanSelection();
    graph.select(node);
    setSelectedNodeId(id);
    setSelectedNodeLabel(node.getData<NodeData>().label);
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(true);
    setDirty(true);
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    if (options.beginEditing) {
      requestAnimationFrame(() => {
        if (isMindMap) revealDiagramNode(graph, node);
        beginNodeEdit(node);
      });
    }
  }, [beginNodeEdit, document, readOnly, selectedNodeId, t]);

  const placeArchitectureItem = useCallback((
    item: ArchitectureLibraryItem,
    position: { x: number; y: number },
  ) => {
    addNode(item.shape, {
      label: t(item.labelKey),
      position,
      resourceIcon: architectureResourceIcon(item),
    });
    setPendingArchitectureItem(null);
    requestAnimationFrame(() => containerRef.current?.focus({ preventScroll: true }));
  }, [addNode, t]);

  const handleArchitectureDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (document?.kind !== "architecture" || readOnly || !isArchitectureLibraryDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleArchitectureDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (document?.kind !== "architecture" || readOnly || !isArchitectureLibraryDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const resourceIcon = architectureLibraryDragIcon(event);
    const item = ARCHITECTURE_LIBRARY_ITEMS.find((candidate) => architectureResourceIcon(candidate) === resourceIcon);
    const graph = graphRef.current;
    if (!item || !graph) return;
    const dropPoint = clampArchitectureDropClientPoint(
      graph,
      canvasSurfaceRef.current,
      item,
      { x: event.clientX, y: event.clientY },
    );
    placeArchitectureItem(item, diagramClientToLocalPoint(graph, dropPoint));
  };

  const handlePendingArchitecturePlacement = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pendingArchitectureItem || document?.kind !== "architecture" || readOnly || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".x6-node, .x6-edge, input, textarea, [role='dialog']")) return;
    const graph = graphRef.current;
    if (!graph) return;
    event.preventDefault();
    event.stopPropagation();
    const placementPoint = clampArchitectureDropClientPoint(
      graph,
      canvasSurfaceRef.current,
      pendingArchitectureItem,
      { x: event.clientX, y: event.clientY },
    );
    placeArchitectureItem(pendingArchitectureItem, diagramClientToLocalPoint(graph, placementPoint));
  };

  insertNodeRef.current = (relation, baseNodeId) => {
    addNode("topic", { relation, baseNodeId, beginEditing: true });
  };

  const updateSelectedLabel = (label: string) => {
    setSelectedNodeLabel(label);
    const node = selectedNodeId ? graphRef.current?.getCellById(selectedNodeId) : null;
    if (!node?.isNode() || readOnly) return;
    const data = node.getData<NodeData>();
    const isArchitecture = document?.kind === "architecture";
    let nextResourceIcon = data?.resourceIcon;
    if (isArchitecture) {
      const inferred = inferArchitectureResourceIcon(label, t);
      if (inferred && inferred !== data?.resourceIcon) {
        nextResourceIcon = inferred;
      }
    }
    node.setData({ ...data, label, ...(nextResourceIcon ? { resourceIcon: nextResourceIcon } : {}) });
    refreshNodeLabel(node, label);
    if (isArchitecture && nextResourceIcon && nextResourceIcon !== data?.resourceIcon) {
      const shape = data?.shape ?? "service";
      const visual = architectureNodeVisual(shape, appearanceRef.current, node.getSize(), nextResourceIcon);
      node.setMarkup(visual.markup);
      node.replaceAttrs({
        body: visual.body,
        label: { ...visual.label, text: label },
        ...visual.attrs,
      });
    }
  };

  const updateSelectedResourceIcon = (resourceIcon: ArchitectureResourceIcon) => {
    const node = selectedNodeId ? graphRef.current?.getCellById(selectedNodeId) : null;
    if (!node?.isNode() || readOnly || document?.kind !== "architecture") return;
    const data = node.getData<NodeData>() ?? { label: "", shape: "service" };
    node.setData({ ...data, resourceIcon });
    const visual = architectureNodeVisual(data.shape, appearanceRef.current, node.getSize(), resourceIcon);
    node.setMarkup(visual.markup);
    node.replaceAttrs({
      body: visual.body,
      label: { ...visual.label, text: node.attr("label/text") ?? data.label },
      ...visual.attrs,
    });
  };

  const updateSelectedEdgeLabel = (label: string) => {
    setSelectedEdgeLabel(label);
    const edge = selectedEdgeId ? graphRef.current?.getCellById(selectedEdgeId) : null;
    if (!edge?.isEdge() || readOnly) return;
    if (!label) {
      edge.setLabels([]);
      return;
    }
    const palette = resolveDiagramPalette(themeRef.current, appearanceRef.current);
    const edgeKind = edge.getData<EdgeData>()?.kind;
    edge.setLabels([diagramEdgeLabel(label, palette, document?.kind ?? "flowchart", appearanceRef.current, themeRef.current, edgeKind)]);
  };

  const createConnectedFlowNode = (shape: DiagramNodeShape) => {
    const graph = graphRef.current;
    const pending = flowQuickCreate;
    if (!graph || !document || document.kind !== "flowchart" || !pending || readOnly) return;
    const settleScroller = suspendScrollerAutoResize(graph, scrollerResumeTimerRef, () => graphRef.current === graph);
    if (!graph.getCellById(pending.sourceNodeId)?.isNode()) {
      dismissFlowQuickCreate();
      return;
    }
    const size = compactFlowchartNodeSize(shape);
    const id = createId("node");
    const label = shape === "decision"
      ? t("diagram.newDecision")
      : shape === "terminator"
        ? t("diagram.newTerminator")
        : t("diagram.newStep");
    const draftEdge = graph.getCellById(pending.draftEdgeId);
    if (draftEdge?.isEdge()) removeFlowDraftEdge(graph, draftEdge, pending.restoreHistory);
    if (pending.restoreHistory) graph.enableHistory();
    flowQuickCreateRef.current = null;
    setFlowQuickCreate(null);
    graph.startBatch("quick-create");
    const node = graph.addNode(nodeMetadata({
      id,
      label,
      x: Math.round(Math.max(0, pending.x - size.width / 2)),
      y: Math.round(Math.max(0, pending.y - size.height / 2)),
      width: size.width,
      height: size.height,
      shape,
    }, themeRef.current, document.kind, appearanceRef.current, structureRef.current));
    graph.addEdge({
      ...edgeMetadata(
        { id: createId("edge"), source: pending.sourceNodeId, target: id },
        document.kind,
        themeRef.current,
        appearanceRef.current,
      ),
      source: { cell: pending.sourceNodeId, ...(pending.sourcePort ? { port: pending.sourcePort } : {}) },
      target: { cell: id, ...(oppositeFlowPort(pending.sourcePort) ? { port: oppositeFlowPort(pending.sourcePort) } : {}) },
    });
    graph.stopBatch("quick-create");
    applyOrthogonalEdgePorts(graph, document.kind);
    settleScroller();
    graph.cleanSelection();
    graph.select(node);
    setSelectedNodeId(id);
    setSelectedNodeLabel(label);
    setHasSelection(true);
    setDirty(true);
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    requestAnimationFrame(() => beginNodeEdit(node));
  };

  const removeSelected = () => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;
    if (!removeGraphSelection(graph)) return;
    setSelectedNodeId(null);
    setSelectedNodeLabel("");
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(false);
    if (document) {
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      ));
    }
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
  };

  const runHistoryAction = (action: "undo" | "redo") => {
    const graph = graphRef.current;
    if (!graph || readOnly) return;
    if (action === "undo") graph.undo();
    else graph.redo();
    applyGraphPalette(
      graph,
      themeRef.current,
      document?.kind ?? "flowchart",
      appearanceRef.current,
      structureRef.current,
    );
    graph.cleanSelection();
    setSelectedNodeId(null);
    setSelectedNodeLabel("");
    setSelectedEdgeId(null);
    setSelectedEdgeLabel("");
    setHasSelection(false);
    setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    if (document) {
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      ));
    }
  };

  const applyAutoLayout = () => {
    const graph = graphRef.current;
    if (!graph || !document || readOnly || graph.getNodes().length === 0) return;
    const layout = computeDiagramLayoutResult(graphToDocument(graph, document.kind, themeRef.current, structureRef.current));
    graph.startBatch("layout");
    let changed = false;
    for (const nodeId of layout.nodeOrder) {
      const node = graph.getCellById(nodeId);
      const geometry = layout.nodes[nodeId];
      if (!node?.isNode()) continue;
      if (!geometry) continue;
      const currentPosition = node.getPosition();
      const currentSize = node.getSize();
      if (currentPosition.x !== geometry.x || currentPosition.y !== geometry.y) {
        changed = true;
        node.position(geometry.x, geometry.y);
      }
      if (currentSize.width !== geometry.width || currentSize.height !== geometry.height) {
        changed = true;
        node.resize(geometry.width, geometry.height);
      }
    }
    if (usesOrthogonalDiagramEdges(document.kind)) applyOrthogonalEdgePorts(graph, document.kind);
    if (document.kind === "mind-map") applyMindMapHierarchy(graph, themeRef.current, appearanceRef.current, structureRef.current);
    graph.stopBatch("layout");
    ensureDiagramPaperContainsNodes(graph);
    fitDiagramContent(graph, document, containerRef.current, 40, layout.viewport);
    if (changed) {
      setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      ));
      setHistoryState({ undo: graph.canUndo(), redo: graph.canRedo() });
    }
  };

  const applyTheme = (nextTheme: DiagramTheme) => {
    const graph = graphRef.current;
    const nextResolvedTheme = document?.kind === "flowchart"
      ? resolveFlowchartTheme(nextTheme)
      : resolveDiagramTheme(nextTheme);
    if (nextResolvedTheme === theme) return;
    themeRef.current = nextResolvedTheme;
    setTheme(nextResolvedTheme);
    if (!graph || readOnly) return;
    applyGraphPalette(
      graph,
      nextResolvedTheme,
      document?.kind ?? "flowchart",
      appearanceRef.current,
      structureRef.current,
    );
    setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
      titleRef.current,
      graphToDocument(graph, document?.kind ?? "flowchart", nextResolvedTheme, structureRef.current),
    ));
  };

  const applyStructure = (nextStructure: DiagramStructure) => {
    const graph = graphRef.current;
    if (nextStructure === structure) return;
    structureRef.current = nextStructure;
    setStructure(nextStructure);
    if (!graph || readOnly || document?.kind !== "mind-map") return;
    applyGraphPalette(graph, themeRef.current, "mind-map", appearanceRef.current, nextStructure);
    applyAutoLayout();
    setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
      titleRef.current,
      graphToDocument(graph, "mind-map", themeRef.current, nextStructure),
    ));
  };

  const exportDiagram = (format: "png" | "svg") => {
    const graph = graphRef.current;
    if (!graph || !document) return;
    const fallbackName = document.kind === "mind-map" ? t("diagram.mindMap") : document.kind === "architecture" ? t("diagram.architecture") : t("diagram.flowchart");
    const fileName = (title.trim() || fallbackName).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    setSaveError(null);
    try {
      const canvas = diagramCanvasColor(document.kind, themeRef.current, appearanceRef.current);
      const beforeSerialize = prepareExportSvg(canvas);
      const viewBox = graph.getCellsBBox(graph.getCells()) ?? undefined;
      if (format === "png") {
        graph.exportPNG(fileName, { backgroundColor: canvas, padding: 32, ratio: 2, copyStyles: false, beforeSerialize, viewBox });
      } else {
        graph.exportSVG(fileName, { preserveDimensions: true, copyStyles: false, beforeSerialize, viewBox });
      }
    } catch {
      setSaveError(t("diagram.exportError"));
    }
  };

  const save = async () => {
    const graph = graphRef.current;
    const currentMemo = memoRef.current;
    const editSession = editSessionRef.current;
    if (!graph || !document || !editSession || readOnly || saving) return false;
    if (
      savedSnapshotRef.current === diagramEditorSnapshot(titleRef.current, graphToDocument(graph, document.kind, themeRef.current, structureRef.current))
      && !tagsDirty
    ) {
      setDirty(false);
      return true;
    }
    setSaving(true);
    setSaveError(null);
    setSaveFailed(false);
    try {
      const nextDocument = graphToDocument(graph, document.kind, themeRef.current, structureRef.current);
      const markdown = serializeDiagramDocument(nextDocument);
      const nextTitle = titleRef.current;
      const nextTags = parseTagsText(tagsRef.current);
      const nextSnapshot = diagramEditorSnapshot(nextTitle, nextDocument);
      const result = await repository.updateMemo(currentMemo, {
        expectedRevision: currentMemo.revision,
        expectedContentHash: currentMemo.contentHash,
        editSessionId: editSession.id,
        title: nextTitle,
        contentJson: markdownToDoc(diagramFallbackMarkdown(nextDocument)),
        contentMarkdown: markdown,
        tags: nextTags,
      });
      memoRef.current = result.memo;
      savedSnapshotRef.current = nextSnapshot;
      const currentSnapshot = diagramEditorSnapshot(
        titleRef.current,
        graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
      );
      const hasNewChanges = currentSnapshot !== nextSnapshot;
      const hasNewTagChanges = parseTagsText(tagsRef.current).join("\u0000") !== result.memo.tags.join("\u0000");
      setDirty(hasNewChanges);
      setTagsDirty(hasNewTagChanges);
      if (!hasNewTagChanges) {
        const savedTagsText = result.memo.tags.join(", ");
        tagsRef.current = savedTagsText;
        setTagsText(savedTagsText);
      }
      if (!hasNewChanges && !hasNewTagChanges) {
        graph.cleanHistory();
        setHistoryState({ undo: false, redo: false });
        await onSaved(result.memo);
      }
      return true;
    } catch (error) {
      setSaveFailed(true);
      setSaveError(error instanceof Error ? error.message : t("diagram.saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => { void save(); };

  useEffect(() => {
    if (readOnly || !editorDirty || nodeEditor !== null || saving || !editSessionReady || saveFailed) return;
    const timer = window.setTimeout(() => saveRef.current(), EDITOR_LOCAL_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirtyVersion, editSessionReady, editorDirty, nodeEditor, readOnly, saveFailed, saving]);

  const handleCopyMemoId = async () => {
    if (isLocalMemoId(memo.id)) return;
    const copied = await copyTextToClipboard(memo.id);
    setMemoIdCopyNotice(copied ? "copied" : "error");
    if (memoIdCopyTimerRef.current !== null) window.clearTimeout(memoIdCopyTimerRef.current);
    memoIdCopyTimerRef.current = window.setTimeout(() => {
      setMemoIdCopyNotice(null);
      memoIdCopyTimerRef.current = null;
    }, copied ? 2200 : 3000);
  };

  const handleSaveAsTemplate = () => {
    if (!document || readOnly) return;
    const name = window.prompt(t("templates.templateNamePrompt"), titleRef.current);
    if (!name?.trim()) return;
    const currentDocument = graphRef.current
      ? graphToDocument(graphRef.current, document.kind, themeRef.current, structureRef.current)
      : document;
    const markdown = serializeDiagramDocument(currentDocument);
    void onSaveAsTemplate({
      ...memoRef.current,
      title: titleRef.current,
      contentJson: markdownToDoc(diagramFallbackMarkdown(currentDocument)),
      contentMarkdown: markdown,
    }, name.trim());
  };

  const handleNotebookChange = (notebookId: string) => {
    const currentMemo = memoRef.current;
    if (readOnly || notebookUpdatePending || notebookId === currentMemo.notebookId) {
      setMobileNotebookSheetOpen(false);
      return;
    }

    setNotebookUpdatePending(true);
    setSaveError(null);
    void (async () => {
      if (editorDirty && !(await save())) return;
      const sourceMemo = memoRef.current;
      await repository.moveMemos({ memoIds: [sourceMemo.id], notebookId });
      const { memo: movedMemo } = await repository.getMemo(sourceMemo.id);
      memoRef.current = movedMemo;
      await onSaved(movedMemo);
    })()
      .catch((error) => {
        setSaveError(error instanceof Error ? error.message : t("diagram.saveError"));
      })
      .finally(() => {
        setNotebookUpdatePending(false);
        setMobileNotebookSheetOpen(false);
      });
  };

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!searchOpen || !query) return [];
    return (graphRef.current?.getNodes() ?? []).filter((node) =>
      (node.getData<NodeData>()?.label ?? "").toLocaleLowerCase().includes(query),
    );
  }, [dirtyVersion, memo.id, searchOpen, searchQuery]);

  const selectSearchMatch = useCallback((index: number) => {
    const graph = graphRef.current;
    const node = searchMatches[index];
    if (!graph || !node) return;
    graph.cleanSelection();
    graph.select(node);
    graph.centerCell(node);
    setSelectedNodeId(node.id);
    setSelectedNodeLabel(node.getData<NodeData>()?.label ?? "");
  }, [searchMatches]);

  const moveSearchMatch = useCallback((direction: -1 | 1) => {
    if (searchMatches.length === 0) return;
    setSearchIndex((current) => {
      const next = (current + direction + searchMatches.length) % searchMatches.length;
      selectSearchMatch(next);
      return next;
    });
  }, [searchMatches.length, selectSearchMatch]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    setSearchIndex(0);
    if (searchMatches[0]) selectSearchMatch(0);
  }, [searchMatches, selectSearchMatch]);

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
  }, [editorDirty, headerStatusCluster, headerTitleSlot, saveError, saving]);

  if (!document) return null;
  const kindLabel = document.kind === "mind-map" ? t("diagram.mindMap") : document.kind === "architecture" ? t("diagram.architecture") : t("diagram.flowchart");
  const assistantMarkdown = graphRef.current
    ? serializeDiagramDocument(graphToDocument(graphRef.current, document.kind, themeRef.current, structureRef.current))
    : memo.contentMarkdown;
  const currentMarkdown = historyOpen && dirty
    ? serializeDiagramDocument(graphRef.current ? graphToDocument(graphRef.current, document.kind, themeRef.current, structureRef.current) : document)
    : memo.contentMarkdown;
  const saveStatus = saveError ? "error" : saving || notebookUpdatePending ? "saving" : editorDirty ? "unsaved" : "saved";
  const saveLabel = saveStatus === "error"
    ? t("editor.saveState.error")
    : saveStatus === "saving"
      ? t("editor.saveState.saving")
      : saveStatus === "unsaved"
        ? t("editor.saveState.unsaved")
        : t("editor.saveState.saved");
  const saveStatusClassName = saveStatus === "error"
    ? "bg-rose-50 text-rose-700"
    : saveStatus === "saved"
      ? "bg-slate-100 text-slate-500"
      : "bg-slate-100 text-slate-700";
  const selectedMindMapNode = selectedNodeId ? graphRef.current?.getCellById(selectedNodeId) : null;
  const mindMapEnterAddsSibling = selectedMindMapNode?.isNode() && Boolean(selectedMindMapNode.getData<NodeData>()?.parentId);

  return (
    <TooltipProvider>
      <div className="relative flex h-full min-h-0 min-w-0 bg-card">
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-card">
        <div className={cn(MEMO_EDITOR_TOP_ROW_CLASS_NAME, "border-b-0")}>
          <div
            className="min-w-0 w-full"
            style={titleStatusClearancePx > 0 ? { paddingRight: titleStatusClearancePx } : undefined}
          >
          <div
            ref={setHeaderTitleSlot}
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 sm:flex-nowrap"
          >
          <MemoEditorTopRowLeading
            mobileBackButton={(
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button className="lg:hidden" size="icon" variant="ghost" aria-label={t("diagram.back")} onClick={() => editorDirty ? setConfirmDiscardOpen(true) : onBackToList()}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("diagram.back")}</TooltipContent>
              </Tooltip>
            )}
            titleInput={(
              <MemoTitleInput
                className="w-full min-w-0 px-2"
                value={title}
                readOnly={readOnly}
                placeholder={kindLabel}
                ariaLabel={t("diagram.title")}
                onValueChange={(nextTitle) => {
                  titleRef.current = nextTitle;
                  setTitle(nextTitle);
                  setDirtyVersion((current) => current + 1);
                  const graph = graphRef.current;
                  if (graph) {
                    setDirty(savedSnapshotRef.current !== diagramEditorSnapshot(
                      nextTitle,
                      graphToDocument(graph, document.kind, themeRef.current, structureRef.current),
                    ));
                  }
                }}
              />
            )}
          />
          <MemoEditorMetadataRow
            rowClassName={MEMO_EDITOR_METADATA_ROW_CLASS_NAME}
            contentMarkdown={memo.contentMarkdown}
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
              setTagsDirty(true);
              setDirtyVersion((current) => current + 1);
            }}
          />
          </div>
          </div>

          <div ref={setHeaderStatusCluster} className="absolute right-1 top-0 flex h-full shrink-0 items-center gap-1 sm:right-2">
            <div className="flex min-w-0 items-center gap-1.5">
            <m.span
              key={`mobile-${saveStatus}`}
              className={cn(
              "inline-flex max-w-[5.5rem] truncate rounded-full px-2 py-1 text-xs font-medium sm:hidden",
              saveStatusClassName,
            )}
              role="status"
              aria-live="polite"
              aria-label={saveError ? `${saveLabel}. ${saveError}` : undefined}
              {...statusSettleMotion}
            >
              {saveLabel}
            </m.span>
            <m.span
              key={saveStatus}
              className={cn(
              "hidden items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium sm:inline-flex",
              saveStatusClassName,
            )}
              role="status"
              aria-live="polite"
              aria-label={saveError ? `${saveLabel}. ${saveError}` : undefined}
              {...statusSettleMotion}
            >
              {saveStatus === "error" ? (
                <CircleAlert className="h-3 w-3" aria-hidden="true" />
              ) : saveStatus === "saving" ? (
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : saveStatus === "unsaved" ? (
                <Pencil className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Check className="h-3 w-3" aria-hidden="true" />
              )}
              {saveLabel}
            </m.span>
            </div>
            <MemoEditorToolbarDivider className="mx-0.5 hidden h-4 sm:block" />
            <div className="flex items-center gap-0.5">
            <MemoEditorFocusModeButton
              desktopFocusMode={desktopFocusMode}
              onToggleDesktopFocusMode={onToggleDesktopFocusMode}
            />
            {!readOnly && saveFailed && (
              <Button variant="soft" size="sm" disabled={saving || !editSessionReady} onClick={() => void save()}>
                <RefreshCw className="h-4 w-4" />
                {t("diagram.retrySave")}
              </Button>
            )}
            <MemoEditorHeaderActions
              moreMenuClassName="w-48"
              onOpenExecutionCenter={onOpenExecutionCenter}
              onSearch={openSearch}
              moreMenuItems={(
                <>
                <DropdownMenuItem disabled={isLocalMemoId(memo.id)} onClick={() => void handleCopyMemoId()}>
                  <Copy className="h-4 w-4 text-slate-500" />
                  {t(isLocalMemoId(memo.id) ? "editor.copyNoteIdAfterSync" : "editor.copyNoteId")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                  <HistoryIcon className="h-4 w-4 text-slate-500" />
                  {t("editor.versionHistory")}
                </DropdownMenuItem>
                {!readOnly && (
                  <DropdownMenuItem disabled={isLocalMemoId(memo.id)} onClick={() => setShareOpen(true)}>
                    <Share2 className="h-4 w-4 text-slate-500" />
                    {t(isLocalMemoId(memo.id) ? "sharing.afterSync" : "sharing.action")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportDiagram("png")}>
                  <FileImage className="h-4 w-4 text-slate-500" />
                  {t("diagram.exportPng")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportDiagram("svg")}>
                  <FileCode2 className="h-4 w-4 text-slate-500" />
                  {t("diagram.exportSvg")}
                </DropdownMenuItem>
                {!readOnly && (
                  <DropdownMenuItem onClick={handleSaveAsTemplate}>
                    <Pencil className="h-4 w-4 text-slate-500" />
                    {t("templates.saveAsTemplate")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {readOnly ? (
                  <>
                    <DropdownMenuItem onClick={() => void onRestored(memo.id)}>
                      <RotateCcw className="h-4 w-4 text-slate-500" />
                      {t("editor.restoreMemo")}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onClick={() => void onPermanentDeleted(memo.id)}>
                      <Trash2 className="h-4 w-4" />
                      {t("editor.deleteForever")}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onClick={() => void onDeleted(memo.id)}>
                    <Trash2 className="h-4 w-4" />
                    {t("editor.deleteMemo")}
                  </DropdownMenuItem>
                )}
                </>
              )}
            />
            </div>
          </div>
        </div>

        {searchOpen ? (
          <EditorNoteSearchBar
            inputRef={searchInputRef}
            query={searchQuery}
            replacement=""
            replaceOpen={false}
            readOnly
            matchCount={searchMatches.length}
            matchLabel={searchQuery.trim() ? `${searchMatches.length > 0 ? searchIndex + 1 : 0}/${searchMatches.length}` : ""}
            onQueryChange={setSearchQuery}
            onReplacementChange={() => undefined}
            onMoveMatch={moveSearchMatch}
            onReplaceAll={() => undefined}
            onClose={() => setSearchOpen(false)}
          />
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <DiagramToolbar
          appearance={resolvedTheme}
          architectureLabels={denseArchitecture ? { showAll: showAllArchitectureLabels, onToggle: () => setShowAllArchitectureLabels((current) => !current) } : undefined}
          canRedo={historyState.redo}
          canUndo={historyState.undo}
          hasSelection={hasSelection}
          leading={!readOnly ? (
            document.kind === "mind-map" ? (
              <DiagramInsertMenu
                items={[
                  { icon: GitBranch, label: t("diagram.addTopic"), onSelect: () => addNode("topic", { relation: "child" }) },
                  { icon: ListTree, label: t("diagram.addSiblingTopic"), onSelect: () => addNode("topic", { relation: "sibling" }) },
                ]}
              />
            ) : document.kind === "architecture" ? (
              <ArchitectureComponentLibrary
                onPick={setPendingArchitectureItem}
                t={t}
              />
            ) : (
              <DiagramInsertMenu
                items={[
                  { icon: Box, label: t("diagram.addStep"), onSelect: () => addNode("process") },
                  { icon: Diamond, label: t("diagram.addDecision"), onSelect: () => addNode("decision") },
                  { icon: Circle, label: t("diagram.addTerminator"), onSelect: () => addNode("terminator") },
                ]}
              />
            )
          ) : undefined}
          onAutoLayout={applyAutoLayout}
          onDeleteSelection={removeSelected}
          onExport={exportDiagram}
          onRedo={() => runHistoryAction("redo")}
          onThemeChange={applyTheme}
          showTheme={document.kind !== "architecture"}
          themeCatalog={document.kind === "flowchart" ? "flowchart" : "mind-map"}
          onStructureChange={document.kind === "mind-map" ? applyStructure : undefined}
          structure={structure}
          onUndo={() => runHistoryAction("undo")}
          zoomPercent={zoomPercent}
          onRead={document.kind === "flowchart" ? () => { if (graphRef.current) readDiagramContent(graphRef.current, document); } : undefined}
          onZoomTo={(percent) => {
            const graph = graphRef.current;
            if (!graph) return;
            zoomDiagram(graph, percent / 100, true);
            ensureDiagramPaperContainsNodes(graph);
          }}
          onZoomIn={() => {
            const graph = graphRef.current;
            if (!graph) return;
            zoomDiagram(graph, 0.1);
            ensureDiagramPaperContainsNodes(graph);
          }}
          onZoomOut={() => {
            const graph = graphRef.current;
            if (!graph) return;
            zoomDiagram(graph, -0.1);
            ensureDiagramPaperContainsNodes(graph);
          }}
          readOnly={readOnly}
          selectionEditor={(
            <>
              {selectedNodeId && !readOnly && document.kind !== "mind-map" && (() => {
                const selectedNode = graphRef.current?.getCellById(selectedNodeId);
                const selectedData = selectedNode?.isNode() ? selectedNode.getData<NodeData>() : undefined;
                const isArchitecture = document?.kind === "architecture";
                const isArchitectureComponent = isArchitecture && selectedData?.shape !== "boundary";
                const selectedIcon: ArchitectureResourceIcon = selectedData?.resourceIcon
                  ?? (selectedData?.shape && ARCHITECTURE_COMPONENT_SHAPES.includes(selectedData.shape as ArchitectureComponentShape)
                    ? ARCHITECTURE_SHAPE_RESOURCE[selectedData.shape as ArchitectureComponentShape]
                    : "service");

                return (
                  <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-sm">
                    {isArchitectureComponent && (
                      <ArchitectureIconPicker
                        currentIcon={selectedIcon}
                        onSelectIcon={updateSelectedResourceIcon}
                        t={t}
                      />
                    )}
                    <span className="shrink-0 text-xs font-medium text-slate-500">{t("diagram.nodeText")}</span>
                    <Input value={selectedNodeLabel} maxLength={120} onChange={(event) => updateSelectedLabel(event.target.value)} />
                  </div>
                );
              })()}
              {selectedEdgeId && !readOnly && (
                <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-sm">
                  <span className="shrink-0 text-xs font-medium text-slate-500">{t("diagram.edgeText")}</span>
                  <Input value={selectedEdgeLabel} maxLength={80} onChange={(event) => updateSelectedEdgeLabel(event.target.value)} />
                </div>
              )}
            </>
          )}
          theme={theme}
        />
        <div
          ref={canvasSurfaceRef}
          className={cn("relative min-h-0 flex-1", pendingArchitectureItem && "cursor-crosshair")}
          onDragOver={handleArchitectureDragOver}
          onDrop={handleArchitectureDrop}
          onPointerDownCapture={handlePendingArchitecturePlacement}
        >
          <div
            ref={containerRef}
            className={cn("edgeever-diagram-canvas absolute inset-0 touch-none outline-none", pendingArchitectureItem && "cursor-crosshair")}
            data-architecture-placement={pendingArchitectureItem ? "active" : undefined}
            data-diagram-appearance={resolvedTheme}
            data-diagram-kind={document.kind}
            data-label-mode={denseArchitecture && !showAllArchitectureLabels ? "focus" : "all"}
            data-diagram-theme={theme}
            data-shift-select={shiftSelectActive ? "active" : undefined}
            data-space-pan={spacePanActive ? "active" : undefined}
            tabIndex={0}
            aria-label={t("diagram.canvas", { type: kindLabel })}
          />
          {!readOnly && (
            <div
              className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-6.5rem)] flex-wrap select-none items-center gap-1 rounded-xl border border-slate-200/80 bg-white/90 px-2 py-0.5 text-[11px] text-slate-500 shadow-xs backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-400"
              role="status"
              aria-live="polite"
            >
              <span>{t("diagram.navHintPan")}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className={cn("inline-flex items-center gap-1 transition-colors duration-150", shiftSelectActive && "font-medium text-slate-950")}>
                <kbd className={cn("inline-flex items-center rounded border px-1 py-px font-medium transition-colors duration-150", shiftSelectActive ? "border-slate-400 bg-slate-100 text-slate-950" : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300")}>
                  Shift
                </kbd>
                <span>{t("diagram.navHintBoxSelect")}</span>
              </span>
              {denseArchitecture && !showAllArchitectureLabels ? (
                <>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span>{t("diagram.navHintFocusRelations")}</span>
                </>
              ) : null}
              {document.kind === "mind-map" && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-slate-200 bg-slate-100 px-1 py-px font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Tab</kbd>
                    {t("diagram.navHintAddChild")}
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-slate-200 bg-slate-100 px-1 py-px font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">Enter</kbd>
                    {t(mindMapEnterAddsSibling ? "diagram.navHintAddSibling" : "diagram.navHintAddChild")}
                  </span>
                </>
              )}
            </div>
          )}
          {pendingArchitectureItem ? (
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-md border border-slate-200 bg-card/95 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm" role="status">
              {t("diagram.placeShapeHint", { shape: t(pendingArchitectureItem.labelKey) })}
            </div>
          ) : null}
          {flowQuickCreate ? (
            <div
              className="absolute z-30 w-[330px] max-w-[calc(100%-24px)] rounded-xl border border-slate-200 bg-card p-2 shadow-xl"
              style={{ left: flowQuickCreate.left, top: flowQuickCreate.top }}
              role="dialog"
              aria-label={t("diagram.quickCreateTitle")}
              onKeyDown={(event) => {
                const shape = ({ "1": "process", "2": "decision", "3": "terminator" } as const)[event.key as "1" | "2" | "3"];
                if (shape) {
                  event.preventDefault();
                  createConnectedFlowNode(shape);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  dismissFlowQuickCreate();
                  containerRef.current?.focus({ preventScroll: true });
                }
              }}
            >
              <div className="whitespace-nowrap px-1.5 pb-1.5 text-xs font-medium text-slate-500">{t("diagram.quickCreateTitle")}</div>
              <div className="grid grid-cols-3 gap-1">
                <Button autoFocus className="relative h-16 min-w-0 flex-col gap-1 whitespace-nowrap px-2 text-xs" variant="ghost" aria-label={t("diagram.addStep")} onClick={() => createConnectedFlowNode("process")}>
                  <kbd className="absolute right-1.5 top-1 text-xs font-normal text-slate-400">1</kbd>
                  <Box className="h-6 w-6" />
                  {t("diagram.addStep")}
                </Button>
                <Button className="relative h-16 min-w-0 flex-col gap-1 whitespace-nowrap px-2 text-xs" variant="ghost" aria-label={t("diagram.addDecision")} onClick={() => createConnectedFlowNode("decision")}>
                  <kbd className="absolute right-1.5 top-1 text-xs font-normal text-slate-400">2</kbd>
                  <Diamond className="h-6 w-6" />
                  {t("diagram.addDecision")}
                </Button>
                <Button className="relative h-16 min-w-0 flex-col gap-1 whitespace-nowrap px-2 text-xs" variant="ghost" aria-label={t("diagram.addTerminator")} onClick={() => createConnectedFlowNode("terminator")}>
                  <kbd className="absolute right-1.5 top-1 text-xs font-normal text-slate-400">3</kbd>
                  <Circle className="h-6 w-6" />
                  {t("diagram.addTerminator")}
                </Button>
              </div>
              <div className="whitespace-nowrap px-1.5 pt-1 text-xs text-slate-400">{t("diagram.quickCreateShortcuts")}</div>
            </div>
          ) : null}
          {nodeEditor ? (
            <input
              autoFocus
              className="absolute z-20 px-3 text-center font-medium outline-none"
              style={{
                left: nodeEditor.left,
                top: nodeEditor.top,
                width: nodeEditor.width,
                height: nodeEditor.height,
                fontSize: nodeEditor.fontSize,
                color: nodeEditor.color,
                background: nodeEditor.background,
                border: `2px solid ${nodeEditor.borderColor}`,
                borderRadius: nodeEditor.shape === "terminator" ? 999 : 10,
                clipPath: nodeEditor.shape === "decision" ? "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" : undefined,
              }}
              value={nodeEditor.value}
              maxLength={120}
              aria-label={t("diagram.editNode")}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const nextEditor = { ...nodeEditor, value: event.target.value };
                nodeEditorRef.current = nextEditor;
                setNodeEditor(nextEditor);
              }}
              onBlur={() => { finishNodeEdit(); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  finishNodeEdit(true);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const editedNode = finishNodeEdit();
                  if (document.kind === "mind-map" && editedNode) {
                    requestAnimationFrame(() => insertNodeRef.current("sibling", editedNode.id));
                  }
                  return;
                }
                if (event.key === "Tab") {
                  event.preventDefault();
                  const editedNode = finishNodeEdit();
                  if (editedNode) {
                    requestAnimationFrame(() => {
                      if (document.kind === "mind-map") insertNodeRef.current("child", editedNode.id);
                      else if (document.kind === "flowchart") openFlowQuickCreateRef.current(editedNode);
                    });
                  }
                }
              }}
            />
          ) : null}
        </div>
      </div>
        {confirmDiscardOpen ? (
          <AppConfirmDialog
            title={t("diagram.discardTitle")}
            description={t("diagram.discardDescription")}
            confirmLabel={t("diagram.discard")}
            tone="danger"
            onCancel={() => setConfirmDiscardOpen(false)}
            onConfirm={onBackToList}
          />
        ) : null}
        {historyOpen ? (
          <RevisionHistoryDialog
            memo={memo}
            repository={repository}
            currentMarkdown={currentMarkdown}
            onClose={() => setHistoryOpen(false)}
            onRestored={async (restoredMemo) => {
              setHistoryOpen(false);
              await onSaved(restoredMemo);
            }}
          />
        ) : null}
        <ShareMemoDialog memoId={memo.id} open={shareOpen} onOpenChange={setShareOpen} />
        {memoIdCopyNotice ? (
          <ClipboardCopyNotice status={memoIdCopyNotice}>
            {t(memoIdCopyNotice === "copied" ? "editor.noteIdCopied" : "editor.noteIdCopyFailed", { id: memo.id })}
          </ClipboardCopyNotice>
        ) : null}
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
              className="absolute bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-30 size-11 rounded-full border-slate-200 bg-card text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.14)] hover:bg-card hover:text-slate-950"
              aria-label={t("aiAssistant.open")}
              onClick={() => {
                setAiSidebarOpen(true);
                if (editorDirty) saveRef.current();
              }}
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
          companionAvailable={companionAvailable}
          contentMarkdown={assistantMarkdown}
          memoId={memo.id}
          notebookId={memo.notebookId}
          notebookTitle={notebookOptions.find((notebook) => notebook.id === memo.notebookId)?.name}
          noteTitle={title}
          beforeCompanionApply={async () => {
            if (editorDirty && !(await save())) throw new Error("save failed");
            await beforeCompanionApply?.();
          }}
          onCompanionNotesChanged={onCompanionNotesChanged}
          onOpenCompanionNote={onOpenCompanionNote}
        />
      </AiSidebarErrorBoundary>
      </div>
    </TooltipProvider>
  );
};

export default DiagramEditorPane;
