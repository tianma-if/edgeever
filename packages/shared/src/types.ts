import type { AiModelCapabilities } from "./ai-model-capabilities";
import type { TiptapDoc } from "./content";
import type { AiAction, AiPromptParameterKind, AiPromptResultMode } from "./ai-assistant";
import type { DiagramKind, DiagramSummaryPreview } from "./diagram";
import type { TableSummaryPreview } from "./table";

export type NoteCreateKind = DiagramKind | "infographic" | "table" | "poster";

export type Notebook = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string | null;
  icon: string | null;
  color: string | null;
  textColor?: string | null;
  /** Older clients omit this; defaults to coloring the icon. */
  colorTarget?: "icon" | "name" | "both";
  isBold?: boolean;
  iconInverted?: boolean;
  rowInverted?: boolean;
  sortOrder: number;
  memoCount: number;
  lastMemoUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoSummary = {
  id: string;
  notebookId: string;
  title: string | null;
  excerpt: string;
  diagramKind?: DiagramKind | null;
  diagramPreview?: DiagramSummaryPreview;
  structuredTable?: boolean;
  tablePreview?: TableSummaryPreview;
  infographic?: boolean;
  poster?: boolean;
  videoNote?: boolean;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type MemoDetail = MemoSummary & {
  contentJson: TiptapDoc;
  contentMarkdown: string;
  contentText: string;
  contentHash: string;
  sourceMemoIds: string[];
  mergeSourceCount: number;
  mergedIntoMemoId: string | null;
};

export type MemoTemplate = {
  id: string;
  name: string;
  description: string | null;
  title: string | null;
  contentJson: TiptapDoc;
  contentMarkdown: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceExtensionSourceKind = "marketplace" | "github" | "manifest";

export type WorkspaceExtension = {
  extensionId: string;
  type: "plugin" | "theme";
  version: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  deletedAt: string | null;
  manifestUrl: string;
  sourceKind: WorkspaceExtensionSourceKind;
  verified: boolean;
  repositoryUrl: string | null;
  releaseTag: string | null;
  publisher: "edgeever" | null;
};

export type ScheduledTaskMissedRunPolicy = "run-once" | "skip";

export type ScheduledPluginCommandPayload = {
  pluginId: string;
  commandId: string;
};

export type ScheduledTask = {
  id: string;
  name: string;
  taskType: "plugin-command";
  taskPayload: ScheduledPluginCommandPayload;
  ownerPluginId: string | null;
  pluginScheduleKey: string | null;
  cronExpression: string;
  timezone: string;
  executorDeviceId: string;
  missedRunPolicy: ScheduledTaskMissedRunPolicy;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun: ScheduledTaskRun | null;
};

export type ScheduledTaskRun = {
  id: string;
  taskId: string;
  scheduledFor: string;
  executorDeviceId: string;
  status: "running" | "succeeded" | "failed";
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type MemoEditSession = {
  id: string;
  memoId: string;
  baseRevision: number;
  baseContentHash: string;
  expiresAt: string;
};

export type MemoRevision = {
  id: string;
  memoId: string;
  revision: number;
  title: string | null;
  tags: string[];
  contentMarkdown: string;
  contentText: string;
  contentHash: string;
  createdBy: string;
  createdAt: string;
};

export type ResourceKind = "image" | "attachment";

export type Resource = {
  id: string;
  memoId: string;
  originalMemoId: string | null;
  kind: ResourceKind;
  mimeType: string | null;
  filename: string | null;
  byteSize: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type ResourceListItem = Resource & {
  memoTitle: string | null;
  memoExcerpt: string | null;
  memoDeleted: boolean;
};

export type ResourceStorageSummary = {
  totalCount: number;
  totalBytes: number;
  imageCount: number;
  attachmentCount: number;
};

export type ObjectStorageSettings = {
  provider: "builtin" | "s3";
  displayName: string;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  accessKeyId: string | null;
  hasSecretAccessKey: boolean;
  forcePathStyle: boolean;
  objectPrefix: string;
  encryptionConfigured: boolean;
};

export type AiProvider = "openai-compatible" | "anthropic" | "google";

export type AiTranscriptionStandard = "openai-compatible";

export type AiModelConfig = {
  id: string;
  providerConfigId: string;
  modelId: string;
  displayName: string;
  /** Model-level output budgets; `null` uses the EdgeEver default. Older servers omit these fields. */
  generationMaxOutputTokens?: number | null;
  tagSuggestionMaxOutputTokens?: number | null;
  companionMaxOutputTokens?: number | null;
  /** Limits detected from the provider (#652); `null` when never detected, absent on older servers. */
  detectedCapabilities?: AiModelCapabilities | null;
};

export type AiProviderConfig = {
  id: string;
  provider: AiProvider;
  displayName: string;
  baseUrl: string;
  isEnabled: boolean;
  hasApiKey: boolean;
  models: AiModelConfig[];
  credentialsUnavailable?: boolean;
};

export type AiSettings = {
  providers: AiProviderConfig[];
  defaultModelId: string | null;
  encryptionConfigured: boolean;
  readOnly: boolean;
};

export type AiTranscriptionModel = {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
};

export type AiTranscriptionProvider = {
  id: string;
  provider: AiTranscriptionStandard;
  displayName: string;
  baseUrl: string;
  isEnabled: boolean;
  hasApiKey: boolean;
  models: AiTranscriptionModel[];
  credentialsUnavailable?: boolean;
};

export type AiTranscriptionSettings = {
  providers: AiTranscriptionProvider[];
  defaultModelId: string | null;
  enabled: boolean;
  encryptionConfigured: boolean;
  readOnly: boolean;
};

export type AiPromptTemplate = {
  id: string;
  origin: "default" | "custom";
  seedKey: Exclude<AiAction, "custom"> | null;
  action: AiAction;
  parameterKind: AiPromptParameterKind;
  resultMode: AiPromptResultMode;
  nameCustomized: boolean;
  descriptionCustomized: boolean;
  instructionCustomized: boolean;
  name: string;
  description: string | null;
  instruction: string;
  createdAt: string;
  updatedAt: string;
};

export type AiDiscoveredModel = {
  modelId: string;
  displayName: string;
};

export type AiStreamEvent =
  | { type: "start" }
  | { type: "text-delta"; text: string }
  /** The whole draft so far; replaces what earlier deltas built (a long run fixes up its parts). */
  | { type: "text-reset"; text: string }
  /** A long run moved on to part `part` (1-based) of `parts` (#652). */
  | { type: "progress"; part: number; parts: number }
  /**
   * `truncated`: the provider stopped at its output or context limit, so the result is incomplete.
   * `incompleteParts`: parts (1-based) of a long run that kept their source text.
   */
  | { type: "finish"; finishReason?: string; truncated?: boolean; incompleteParts?: number[]; inputTokens?: number; outputTokens?: number }
  | { type: "error"; code: string; message: string };

export type AiTagSuggestion = {
  name: string;
  existing: boolean;
};

export type AiTagSuggestionsResponse = {
  suggestions: AiTagSuggestion[];
};

export type ApiToken = {
  id: string;
  name: string;
  token: string | null;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  isRevoked: boolean;
  createdAt: string;
};

export type CreatedApiToken = {
  token: string;
  apiToken: ApiToken;
};

export type TagSummary = {
  name: string;
  memoCount: number;
  updatedAt: string | null;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: "owner" | "member";
};

export type InstanceUser = AuthUser & {
  isDisabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AuthSession = {
  authRequired: boolean;
  authenticated: boolean;
  demoMode: boolean;
  user: AuthUser | null;
  sessionToken?: string;
  /** Signed in with a recovery code: only TOTP rebinding is allowed until done. */
  mfaRebindRequired?: boolean;
};

export type MfaMethod = "totp" | "recovery_code";

/** `error.details` of a 401 `mfa_required` login response. */
export type MfaChallenge = {
  challengeToken: string;
  expiresAt: string;
  methods: MfaMethod[];
};

export type TotpStatus = {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  /** False when the deployment cannot encrypt secrets or runs as the demo. */
  available: boolean;
  unavailableReason: "encryption_unavailable" | "demo" | null;
  /** The current session came from a recovery code and must rebind. */
  rebindRequired: boolean;
};

export type TotpSetupResponse = {
  /** Identifies this setup; `setup/verify` sends it back so a setup replaced by a newer one is refused. */
  setupId: string;
  secret: string;
  otpauthUri: string;
  issuer: string;
  accountName: string;
  expiresAt: string;
};

export type TotpRecoveryCodesResponse = {
  /** Identifies this batch; the confirm step sends it back so only the codes the user saw are activated. */
  batchId: string;
  recoveryCodes: string[];
};

export type TotpConfirmResponse = {
  ok: true;
  /** Rotated session token after a restricted session finishes rebinding. */
  sessionToken?: string;
};

export type LoginDeviceSession = {
  id: string;
  userAgent: string | null;
  label: string | null;
  ipAddress: string | null;
  ipCountry: string | null;
  ipRegion: string | null;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
