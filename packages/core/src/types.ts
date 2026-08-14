export const PROVIDER_IDS = [
  "chatgpt",
  "claude",
  "doubao",
  "kimi",
  "deepseek",
  "hunyuan",
  "qianwen",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  doubao: "豆包",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  hunyuan: "腾讯元宝",
  qianwen: "千问",
};

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "pending" | "streaming" | "completed" | "failed";
export const PROVIDER_FAILURE_ORIGINS = [
  "client",
  "external",
  "auth",
  "cancelled",
] as const;
export type ProviderFailureOrigin =
  (typeof PROVIDER_FAILURE_ORIGINS)[number];
export type ProviderSendPhase =
  | "checking-auth"
  | "capturing-anchor"
  | "configuring-model"
  | "configuring-modes"
  | "preparing-attachments"
  | "uploading-attachments"
  | "typing-message"
  | "submitting"
  | "confirming-submit"
  | "binding-assistant"
  | "waiting-first-token"
  | "streaming"
  | "detecting-completion"
  | "recoverable-blocked"
  | "completed"
  | "failed";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; language?: string; text: string }
  | { type: "attachment"; name: string; localPath?: string }
  | { type: "citation"; title?: string; url: string }
  | { type: "image"; src: string; alt?: string; title?: string }
  | {
      type: "math";
      tex: string;
      display: boolean;
      source: "katex" | "mathjax" | "mathml";
    }
  | {
      type: "html";
      html: string;
      kind: "provider-assistant";
    };

export interface NormalizedMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: ContentBlock[];
  providerHtml?: string;
  status: MessageStatus;
  statusPhase?: ProviderSendPhase;
  statusDetail?: string;
  errorCode?: string;
  failureOrigin?: ProviderFailureOrigin;
  provider: ProviderId;
  createdAt: string;
}

export interface NormalizedConversation {
  id: string;
  title: string;
  provider: ProviderId;
  externalId?: string;
  syncStatus?: ConversationSyncStatus;
  lastSyncedAt?: string;
  syncError?: string;
  remoteMissingCount?: number;
  hidden: boolean;
  pinned: boolean;
  pinnedAt?: string;
  systemPromptId?: string;
  documentIds: string[];
  folderId?: string;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
  messages: NormalizedMessage[];
}

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  provider?: ProviderId;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonParticipant {
  conversationId: string;
  provider: ProviderId;
}

export interface ComparisonSession {
  id: string;
  title: string;
  participants: ComparisonParticipant[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  filePath: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationFolder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
}

export interface ConversationTag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export type ConversationSyncStatus =
  | "not-synced"
  | "syncing"
  | "synced"
  | "partial"
  | "error"
  | "remote-missing";

export type ProviderBackendMode = "web" | "api" | "manual";

export interface ProviderApiConfig {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
}

export type LocaleMode = "system" | "zh-CN" | "en-US";
export type InterfaceDensity = "comfortable" | "compact";
export type ContentWidth = "narrow" | "standard" | "wide";
export type MotionPreference = "system" | "reduced" | "full";
export type UiScale = 0.9 | 1 | 1.1 | 1.25;
export type CloseBehavior = "exit" | "minimize-to-tray";
export type ContrastMode = "system" | "standard" | "high";
export type UpdatePolicy = "manual" | "notify" | "auto-download";

export interface ProviderSurfaceLayout {
  surfaceVisible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NotificationPreferences {
  generationCompleted: boolean;
  generationFailed: boolean;
  syncFailed: boolean;
  showPreview: boolean;
}

export interface AppSettingsPayload {
  theme?: "dark" | "light" | "system";
  locale?: LocaleMode;
  defaultProvider?: ProviderId | null;
  enabledProviders?: ProviderId[];
  providerOrder?: ProviderId[];
  providerBackends?: Partial<Record<ProviderId, ProviderBackendMode>>;
  providerApiConfigs?: Partial<Record<ProviderId, ProviderApiConfig>>;
  autoSyncWebHistory?: boolean;
  uiScale?: UiScale;
  density?: InterfaceDensity;
  contentWidth?: ContentWidth;
  codeWrap?: boolean;
  motion?: MotionPreference;
  contrastMode?: ContrastMode;
  automaticBackup?: boolean;
  backupRetentionDays?: 7 | 30 | 90 | 365;
  trashRetentionDays?: 7 | 30 | 90 | 0;
  trayEnabled?: boolean;
  closeBehavior?: CloseBehavior;
  launchAtLogin?: boolean;
  notificationPreferences?: NotificationPreferences;
  updatePolicy?: UpdatePolicy;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  providerDrawerWidth?: number;
  providerSplitRatio?: number;
  hasCompletedOnboarding?: boolean;
  shortcuts?: Record<string, string>;
}

export interface SettingsImportChange {
  key: string;
  before?: unknown;
  after?: unknown;
}

export interface SettingsImportPreview {
  candidate: AppSettingsPayload;
  changes: SettingsImportChange[];
  ignoredKeys: string[];
  warnings: string[];
}

export interface DataStorageSummary {
  userDataPath: string;
  databaseBytes: number;
  conversationCount: number;
  messageCount: number;
  documentCount: number;
  documentBytes: number;
  indexedCharacterCount: number;
}

export interface AppDataExportV1 {
  format: "aihub-data";
  version: 1;
  appVersion: string;
  exportedAt: string;
  conversations: NormalizedConversation[];
  folders: ConversationFolder[];
  tags: ConversationTag[];
  systemPrompts: SystemPrompt[];
  documents: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface DataExportResult {
  canceled: boolean;
  path?: string;
  conversationCount?: number;
  messageCount?: number;
}

export interface DataImportPreview {
  canceled: boolean;
  token?: string;
  fileName?: string;
  conversationCount?: number;
  messageCount?: number;
  folderCount?: number;
  tagCount?: number;
  systemPromptCount?: number;
  conflictCount?: number;
  ignoredKnowledgeDocumentCount?: number;
  adjustedDefaultPromptCount?: number;
  warnings?: string[];
}

export interface DataImportResult {
  conversationCount: number;
  messageCount: number;
  folderCount: number;
  tagCount: number;
  systemPromptCount: number;
  skippedConflictCount: number;
  ignoredKnowledgeDocumentCount: number;
  adjustedDefaultPromptCount: number;
}

export type BackupReason =
  | "manual"
  | "scheduled"
  | "pre-restore"
  | "pre-reset"
  | "pre-update";

export interface BackupManifestV1 {
  format: "aihub-backup";
  version: 1;
  id: string;
  appVersion: string;
  databaseSchemaVersion: number;
  createdAt: string;
  reason: BackupReason;
  databaseFile: string;
  databaseBytes: number;
  sha256: string;
  conversationCount: number;
  messageCount: number;
  documentCount: number;
}

export interface BackupCreateResult {
  backup: BackupManifestV1;
  prunedIds: string[];
}

export interface BackupRestorePreview {
  backup: BackupManifestV1;
  current: {
    conversationCount: number;
    messageCount: number;
    documentCount: number;
  };
  warnings: string[];
  requiresRestart: true;
}

export interface BackupRestoreResult {
  scheduled: boolean;
  backupId: string;
}

export type TrashEntityType =
  | "conversation"
  | "folder"
  | "tag"
  | "system-prompt"
  | "document";

export interface TrashItem {
  type: TrashEntityType;
  id: string;
  label: string;
  deletedAt: string;
  purgeAt?: string;
  provider?: ProviderId;
}

export interface DataResetRequest {
  scope: "local-content" | "provider-sessions" | "everything";
  confirmation: "LLM Workbench";
  createBackup: boolean;
}

export interface DataResetResult {
  scheduledRestart: boolean;
  backupId?: string;
}

export type UpdateStateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export interface UpdateState {
  status: UpdateStateStatus;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  releaseName?: string;
  error?: string;
}

export interface ConversationRef {
  externalId?: string;
}

export interface OutgoingMessage {
  conversationId: string;
  text: string;
  attachments?: OutgoingAttachment[];
  modes?: ProviderMode[];
  model?: string;
}

export const PROVIDER_MODES = [
  "web-search",
  "reasoning",
  "image-understanding",
  "image-generation",
  "coding",
  "documents",
] as const;

export type ProviderMode = (typeof PROVIDER_MODES)[number];

export const ATTACHMENT_KINDS = [
  "image",
  "pdf",
  "word",
  "excel",
  "powerpoint",
  "text",
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface OutgoingAttachment {
  name: string;
  localPath: string;
  kind: AttachmentKind;
  sizeBytes: number;
}

export interface ProviderModeState {
  mode: ProviderMode;
  label: string;
  enabled: boolean;
}

export interface ProviderModelState {
  id: string;
  label: string;
}

export interface ProviderCapabilitySnapshot {
  attachments: AttachmentKind[];
  modes: ProviderModeState[];
  model?: string;
  models: ProviderModelState[];
  multipleAttachments: boolean;
  acceptedTypes: string[];
}

export interface ProviderState {
  authenticated: boolean;
  ready: boolean;
  degraded: boolean;
  reason?: string;
}

export interface ProviderConversationAnchor {
  sequence: number;
  textSignature: string;
  elementSignature: string;
  messageKey?: string;
}

export interface ProviderInteractionTarget {
  action: "composer" | "submit" | "stop" | "retry" | "mode";
  inputMethod: "text" | "click" | "enter";
  x: number;
  y: number;
  width: number;
  height: number;
  elementType:
    | "input"
    | "textarea"
    | "contenteditable"
    | "button"
    | "other";
  fingerprint: string;
}

export interface ProviderTextVerification {
  matched: boolean;
  actualLength: number;
  expectedLength: number;
  actualHash: string;
  expectedHash: string;
  fingerprint: string;
}

export interface ProviderSubmitEvidence {
  confirmed: boolean;
  userTurnSeen: boolean;
  transportSeen: boolean;
  assistantStarted: boolean;
  sessionCreated: boolean;
  retryAllowed: boolean;
  currentConversationId?: string;
}

export interface ProviderTransportEvent {
  requestId: string;
  phase: "started" | "headers" | "completed" | "failed";
  urlPath: string;
  method: string;
  statusCode?: number;
  durationMs?: number;
  resourceType?: string;
  uploadBytes?: number;
  uploadHash?: string;
  markerObserved?: boolean;
  error?: string;
}

export interface WebsiteConversationRef {
  externalId: string;
  title: string;
  url: string;
  isActive?: boolean;
  isPinned?: boolean;
}

export interface WebsiteConversationListSnapshot {
  conversations: WebsiteConversationRef[];
  scanRounds: number;
  partial: boolean;
  fallbackReason?: string;
}

export interface WebsiteMessageSnapshot {
  key: string;
  role: "user" | "assistant";
  order: number;
  content: ContentBlock[];
  providerHtml?: string;
}

export interface WebsiteConversationSnapshot {
  externalId: string;
  title: string;
  url: string;
  messages: WebsiteMessageSnapshot[];
  scanRounds: number;
  partial: boolean;
  limitReached: boolean;
  fallbackReason?: string;
}

export interface WebHistorySyncResult {
  provider: ProviderId;
  discovered: number;
  created: number;
  updated: number;
  partial: boolean;
}

export interface CurrentWebConversationSyncResult {
  provider: ProviderId;
  conversationId: string;
  created: boolean;
  syncedMessages: number;
  partial: boolean;
  syncedAt: string;
}

export interface ProviderDebugSnapshot {
  provider: ProviderId;
  url: string;
  composer: string;
  submit: string;
  submitCandidates?: string[];
  anchor: string;
  assistant: string;
  activeMessageId?: string;
  assistantBinding?: string;
  latestTextLength: number;
  isGenerating: boolean;
  networkActiveCount: number;
  networkIdle: boolean;
  lastNetworkUrl?: string;
  lastTransportEvent?: ProviderTransportEvent;
  documentVisibility?: string;
  documentHasFocus?: boolean;
  lastMutationAt: number;
  completionDecision: string;
  completionSignals: ProviderCompletionSignalSnapshot;
  fallbackUsed: boolean;
  currentConversationId?: string;
  turnCount?: number;
  userMessageCount?: number;
  assistantMessageCount?: number;
  virtualScanRounds?: number;
  historyCacheHit?: boolean;
  historyFallbackReason?: string;
}

export interface ProviderCompletionSignalSnapshot {
  textLength: number;
  hasStopButton: boolean;
  hasStreamingIndicator: boolean;
  networkIdle: boolean;
  hasRecoverableBlocker: boolean;
  recoverableBlockerReason?: string;
  stableMs: number;
  elapsedMs: number;
}

export interface AdapterEventRecord {
  id: number;
  provider: ProviderId;
  type: string;
  detail?: string;
  createdAt: string;
}

export type ProviderSmokeScenario =
  | "normal-send"
  | "background-send"
  | "manual-recovery"
  | "resync-latest";

export interface ProviderSmokeTestRequest {
  provider: ProviderId;
  scenario?: ProviderSmokeScenario;
  timeoutMs?: number;
  targetRuntimeInstanceId?: string;
  prompt?: string;
  modes?: ProviderMode[];
}

export interface ProviderSmokeRuntimeInfo {
  instanceId: string;
  pid: number;
  startedAt: string;
}

export interface ProviderSmokeDiagnostics {
  providerSummary?: ProviderSummary;
  debugSnapshot?: ProviderDebugSnapshot;
  debugSnapshotError?: string;
  adapterEventSinceCreatedAt?: string;
  adapterEvents: AdapterEventRecord[];
}

export interface ProviderSmokeVerification {
  kind:
    | "normal-send-completed"
    | "background-send-completed"
    | "manual-recovery-completed"
    | "resync-latest-completed"
    | "auth-blocked"
    | "recoverable-blocked"
    | "content-mismatch"
    | "timeout"
    | "fatal-error"
    | "unclassified-failure";
  phaseTrace: ProviderSendPhase[];
  diagnosed: boolean;
  synchronized: boolean;
  notes: string[];
}

export interface ProviderSmokeTestResult {
  provider: ProviderId;
  scenario?: ProviderSmokeScenario;
  token?: string;
  runtime?: ProviderSmokeRuntimeInfo;
  stage?: "started" | "running";
  startedAt?: string;
  heartbeatAt?: string;
  pollCount?: number;
  resyncAttempted?: boolean;
  resyncSucceeded?: boolean;
  sendError?: string | null;
  userMessage?: NormalizedMessage;
  assistantMessage?: NormalizedMessage;
  conversation?: NormalizedConversation;
  timeout?: boolean;
  error?: string;
  diagnostics: ProviderSmokeDiagnostics;
  verification?: ProviderSmokeVerification;
}

export interface ProviderSmokeInspection {
  provider: ProviderId;
  status: "matched" | "missing" | "stale";
  currentRuntime?: ProviderSmokeRuntimeInfo;
  result?: ProviderSmokeTestResult;
  staleRuntimeInstanceId?: string;
}

export type ProviderEvent =
  | { type: "auth.changed"; authenticated: boolean }
  | { type: "conversation.changed"; externalId?: string }
  | { type: "conversation.dirty"; externalId?: string }
  | { type: "message.anchor-captured"; messageId?: string; detail: string }
  | { type: "message.assistant-bound"; messageId: string; detail: string }
  | { type: "message.started"; messageId: string }
  | { type: "message.delta"; messageId: string; text: string }
  | {
      type: "message.status";
      messageId?: string;
      phase: ProviderSendPhase;
      detail?: string;
    }
  | {
      type: "message.snapshot";
      messageId: string;
      content: ContentBlock[];
      text: string;
      providerHtml?: string;
      phase?: ProviderSendPhase;
      detail?: string;
    }
  | { type: "message.completed"; message: NormalizedMessage }
  | {
      type: "generation.failed";
      messageId?: string;
      code: string;
      recoverable: boolean;
      phase?: ProviderSendPhase;
      detail?: string;
    }
  | {
      type: "capabilities.changed";
      capabilities: ProviderCapabilitySnapshot;
    }
  | { type: "provider.network-started"; url?: string }
  | { type: "provider.network-idle"; url?: string }
  | { type: "provider.transport"; event: ProviderTransportEvent }
  | {
      type: "provider.debug-snapshot";
      snapshot: ProviderDebugSnapshot;
    }
  | { type: "adapter.degraded"; reason: string };

export interface ProviderAdapter {
  id: ProviderId;
  loginUrl: string;
  allowedOrigins: string[];
  detectState(): Promise<ProviderState>;
  createConversation(): Promise<ConversationRef>;
  sendMessage(input: OutgoingMessage): Promise<void>;
  observeEvents(): AsyncIterable<ProviderEvent>;
  exportConversation(): Promise<NormalizedConversation>;
  cancelGeneration(): Promise<void>;
}

export interface ProviderSummary {
  id: ProviderId;
  authenticated: boolean;
  ready: boolean;
  degraded: boolean;
  reason?: string;
  lastFailurePhase?: ProviderSendPhase;
  lastFailureCode?: string;
  lastFailureOrigin?: ProviderFailureOrigin;
  websiteVisible: boolean;
}

export interface TransferPreview {
  sourceConversationId: string;
  targetProvider: ProviderId;
  compressionProvider?: ProviderId;
  markdown: string;
  messageCount: number;
}

export interface AppSnapshot {
  providers: ProviderSummary[];
  conversations: NormalizedConversation[];
  comparisons: ComparisonSession[];
}
