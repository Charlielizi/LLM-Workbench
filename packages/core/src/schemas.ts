import { z } from "zod";
import {
  ATTACHMENT_KINDS,
  PROVIDER_FAILURE_ORIGINS,
  PROVIDER_IDS,
  PROVIDER_MODES,
  type ProviderId,
  type ProviderSendPhase,
} from "./types";

export const providerIdSchema = z.enum(PROVIDER_IDS);
export const providerFailureOriginSchema = z.enum(PROVIDER_FAILURE_ORIGINS);

export const providerInteractionTargetSchema = z.object({
  action: z.enum(["composer", "submit", "stop", "retry", "mode"]),
  inputMethod: z.enum(["text", "click", "enter"]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  elementType: z.enum([
    "input",
    "textarea",
    "contenteditable",
    "button",
    "other",
  ]),
  fingerprint: z.string().min(1).max(1_000),
});

export const providerTextVerificationSchema = z.object({
  matched: z.boolean(),
  actualLength: z.number().int().nonnegative(),
  expectedLength: z.number().int().nonnegative(),
  actualHash: z.string().min(1).max(128),
  expectedHash: z.string().min(1).max(128),
  fingerprint: z.string().min(1).max(1_000),
});

export const providerSubmitEvidenceSchema = z.object({
  confirmed: z.boolean(),
  userTurnSeen: z.boolean(),
  transportSeen: z.boolean(),
  assistantStarted: z.boolean(),
  sessionCreated: z.boolean(),
  retryAllowed: z.boolean(),
  currentConversationId: z.string().min(1).max(2_000).optional(),
});

export const providerTransportEventSchema = z.object({
  requestId: z.string().min(1),
  phase: z.enum(["started", "headers", "completed", "failed"]),
  urlPath: z.string().min(1).max(2_000),
  method: z.string().min(1).max(20),
  statusCode: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  resourceType: z.string().min(1).max(100).optional(),
  uploadBytes: z.number().int().nonnegative().optional(),
  uploadHash: z.string().min(1).max(128).optional(),
  markerObserved: z.boolean().optional(),
  error: z.string().min(1).max(500).optional(),
});

export const providerAdapterEventsQuerySchema = z.object({
  provider: providerIdSchema,
  limit: z.number().int().min(1).max(500).optional(),
  sinceCreatedAt: z.string().datetime().optional(),
});

export const providerCleanModeSchema = z.object({
  provider: providerIdSchema,
  enabled: z.boolean(),
});

export const providerConversationAnchorSchema = z.object({
  sequence: z.number().int().nonnegative(),
  textSignature: z.string(),
  elementSignature: z.string(),
  messageKey: z.string().min(1).optional(),
});

export const websiteConversationRefSchema = z.object({
  externalId: z.string().min(1),
  title: z.string(),
  url: z.string().url(),
  isActive: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export const webHistorySyncResultSchema = z.object({
  provider: providerIdSchema,
  discovered: z.number().int().nonnegative().max(500),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  partial: z.boolean(),
});

export const currentWebConversationSyncResultSchema = z.object({
  provider: providerIdSchema,
  conversationId: z.string().min(1),
  created: z.boolean(),
  syncedMessages: z.number().int().nonnegative().max(1_000),
  partial: z.boolean(),
  syncedAt: z.string().datetime(),
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("code"),
    language: z.string().optional(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("attachment"),
    name: z.string(),
    localPath: z.string().optional(),
  }),
  z.object({
    type: z.literal("citation"),
    title: z.string().optional(),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("image"),
    src: z.string().min(1),
    alt: z.string().optional(),
    title: z.string().optional(),
  }),
  z.object({
    type: z.literal("math"),
    tex: z.string().min(1),
    display: z.boolean(),
    source: z.enum(["katex", "mathjax", "mathml"]),
  }),
  z.object({
    type: z.literal("html"),
    html: z.string().min(1),
    kind: z.literal("provider-assistant"),
  }),
]);

export const websiteMessageSnapshotSchema = z.object({
  key: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  order: z.number().int().nonnegative(),
  content: z.array(contentBlockSchema),
  providerHtml: z.string().min(1).optional(),
});

export const websiteConversationSnapshotSchema = z.object({
  externalId: z.string().min(1),
  title: z.string(),
  url: z.string().url(),
  messages: z.array(websiteMessageSnapshotSchema).max(1_000),
  scanRounds: z.number().int().nonnegative(),
  partial: z.boolean(),
  limitReached: z.boolean(),
  fallbackReason: z.string().min(1).optional(),
});

export const websiteConversationListSnapshotSchema = z.object({
  conversations: z.array(z.object({
    externalId: z.string().min(1),
    title: z.string().min(1),
    url: z.string().url(),
    isActive: z.boolean().optional(),
    isPinned: z.boolean().optional(),
  })).max(500),
  scanRounds: z.number().int().nonnegative(),
  partial: z.boolean(),
  fallbackReason: z.string().min(1).optional(),
});

export const normalizedMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.array(contentBlockSchema),
  providerHtml: z.string().min(1).optional(),
  status: z.enum(["pending", "streaming", "completed", "failed"]),
  statusPhase: z.custom<ProviderSendPhase>().optional(),
  statusDetail: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  failureOrigin: providerFailureOriginSchema.optional(),
  provider: providerIdSchema,
  createdAt: z.string().datetime(),
});

export const normalizedConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  provider: providerIdSchema,
  externalId: z.string().optional(),
  syncStatus: z.enum([
    "not-synced",
    "syncing",
    "synced",
    "partial",
    "error",
    "remote-missing",
  ]).optional(),
  lastSyncedAt: z.string().datetime().optional(),
  syncError: z.string().optional(),
  remoteMissingCount: z.number().int().nonnegative().optional(),
  hidden: z.boolean(),
  pinned: z.boolean().default(false),
  pinnedAt: z.string().datetime().optional(),
  systemPromptId: z.string().optional(),
  documentIds: z.array(z.string()).default([]),
  folderId: z.string().optional(),
  tagIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(normalizedMessageSchema),
});

export const providerSummarySchema = z.object({
  id: providerIdSchema,
  authenticated: z.boolean(),
  ready: z.boolean(),
  degraded: z.boolean(),
  reason: z.string().optional(),
  lastFailurePhase: z.custom<ProviderSendPhase>().optional(),
  lastFailureCode: z.string().optional(),
  lastFailureOrigin: providerFailureOriginSchema.optional(),
  websiteVisible: z.boolean(),
});

export const adapterEventRecordSchema = z.object({
  id: z.number().int().nonnegative(),
  provider: providerIdSchema,
  type: z.string().min(1),
  detail: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const providerDebugSnapshotSchema = z.object({
  provider: providerIdSchema,
  url: z.string(),
  composer: z.string(),
  submit: z.string(),
  submitCandidates: z.array(z.string()).optional(),
  anchor: z.string(),
  assistant: z.string(),
  activeMessageId: z.string().optional(),
  assistantBinding: z.string().optional(),
  latestTextLength: z.number(),
  isGenerating: z.boolean(),
  networkActiveCount: z.number(),
  networkIdle: z.boolean(),
  lastNetworkUrl: z.string().optional(),
  lastTransportEvent: providerTransportEventSchema.optional(),
  documentVisibility: z.string().optional(),
  documentHasFocus: z.boolean().optional(),
  lastMutationAt: z.number(),
  completionDecision: z.string(),
  completionSignals: z.object({
    textLength: z.number(),
    hasStopButton: z.boolean(),
    hasStreamingIndicator: z.boolean(),
    networkIdle: z.boolean(),
    hasRecoverableBlocker: z.boolean(),
    recoverableBlockerReason: z.string().optional(),
    stableMs: z.number(),
    elapsedMs: z.number(),
  }),
  fallbackUsed: z.boolean(),
  currentConversationId: z.string().optional(),
  turnCount: z.number().int().nonnegative().optional(),
  userMessageCount: z.number().int().nonnegative().optional(),
  assistantMessageCount: z.number().int().nonnegative().optional(),
  virtualScanRounds: z.number().int().nonnegative().optional(),
  historyCacheHit: z.boolean().optional(),
  historyFallbackReason: z.string().optional(),
});

export const providerSmokeTestRequestSchema = z.object({
  provider: providerIdSchema,
  scenario: z.enum([
    "normal-send",
    "background-send",
    "manual-recovery",
    "resync-latest",
  ]).optional(),
  timeoutMs: z.number().int().positive().max(30 * 60 * 1000).optional(),
  targetRuntimeInstanceId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(10_000).optional(),
  modes: z.array(z.enum(PROVIDER_MODES)).max(4).optional(),
});

export const providerSmokeVerificationSchema = z.object({
  kind: z.enum([
    "normal-send-completed",
    "background-send-completed",
    "manual-recovery-completed",
    "resync-latest-completed",
    "auth-blocked",
    "recoverable-blocked",
    "content-mismatch",
    "timeout",
    "fatal-error",
    "unclassified-failure",
  ]),
  phaseTrace: z.array(z.custom<ProviderSendPhase>()),
  diagnosed: z.boolean(),
  synchronized: z.boolean(),
  notes: z.array(z.string()),
});

export const providerSmokeRuntimeInfoSchema = z.object({
  instanceId: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
});

export const providerSmokeDiagnosticsSchema = z.object({
  providerSummary: providerSummarySchema.optional(),
  debugSnapshot: providerDebugSnapshotSchema.optional(),
  debugSnapshotError: z.string().min(1).optional(),
  adapterEventSinceCreatedAt: z.string().datetime().optional(),
  adapterEvents: z.array(adapterEventRecordSchema),
});

export const providerSmokeTestResultSchema = z.object({
  provider: providerIdSchema,
  scenario: z.enum([
    "normal-send",
    "background-send",
    "manual-recovery",
    "resync-latest",
  ]).optional(),
  token: z.string().min(1).optional(),
  runtime: providerSmokeRuntimeInfoSchema.optional(),
  stage: z.enum(["started", "running"]).optional(),
  startedAt: z.string().datetime().optional(),
  heartbeatAt: z.string().datetime().optional(),
  pollCount: z.number().int().nonnegative().optional(),
  resyncAttempted: z.boolean().optional(),
  resyncSucceeded: z.boolean().optional(),
  sendError: z.string().nullable().optional(),
  userMessage: normalizedMessageSchema.optional(),
  assistantMessage: normalizedMessageSchema.optional(),
  conversation: normalizedConversationSchema.optional(),
  timeout: z.boolean().optional(),
  error: z.string().min(1).optional(),
  diagnostics: providerSmokeDiagnosticsSchema,
  verification: providerSmokeVerificationSchema.optional(),
});

export const providerSmokeInspectionSchema = z.object({
  provider: providerIdSchema,
  status: z.enum(["matched", "missing", "stale"]),
  currentRuntime: providerSmokeRuntimeInfoSchema.optional(),
  result: providerSmokeTestResultSchema.optional(),
  staleRuntimeInstanceId: z.string().min(1).optional(),
});

export const comparisonSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  participants: z.array(z.object({
    conversationId: z.string().min(1),
    provider: providerIdSchema,
  })),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const appSnapshotSchema = z.object({
  providers: z.array(providerSummarySchema),
  conversations: z.array(normalizedConversationSchema),
  comparisons: z.array(comparisonSessionSchema),
});

export const providerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.changed"), authenticated: z.boolean() }),
  z.object({
    type: z.literal("conversation.changed"),
    externalId: z.string().optional(),
  }),
  z.object({
    type: z.literal("conversation.dirty"),
    externalId: z.string().optional(),
  }),
  z.object({
    type: z.literal("message.anchor-captured"),
    messageId: z.string().optional(),
    detail: z.string(),
  }),
  z.object({
    type: z.literal("message.assistant-bound"),
    messageId: z.string(),
    detail: z.string(),
  }),
  z.object({ type: z.literal("message.started"), messageId: z.string() }),
  z.object({
    type: z.literal("message.status"),
    messageId: z.string().optional(),
    phase: z.custom<ProviderSendPhase>(),
    detail: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("message.delta"),
    messageId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("message.snapshot"),
    messageId: z.string(),
    content: z.array(contentBlockSchema),
    text: z.string(),
    providerHtml: z.string().min(1).optional(),
    phase: z.custom<ProviderSendPhase>().optional(),
    detail: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("message.completed"),
    message: normalizedMessageSchema,
  }),
  z.object({
    type: z.literal("generation.failed"),
    messageId: z.string().optional(),
    code: z.string(),
    recoverable: z.boolean(),
    phase: z.custom<ProviderSendPhase>().optional(),
    detail: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("capabilities.changed"),
    capabilities: z.object({
      attachments: z.array(z.enum(ATTACHMENT_KINDS)),
      modes: z.array(z.object({
        mode: z.enum(PROVIDER_MODES),
        label: z.string().min(1),
        enabled: z.boolean(),
      })),
      model: z.string().optional(),
      models: z.array(z.object({
        id: z.string().min(1),
        label: z.string().min(1),
      })),
      multipleAttachments: z.boolean(),
      acceptedTypes: z.array(z.string()),
    }),
  }),
  z.object({
    type: z.literal("provider.network-started"),
    url: z.string().optional(),
  }),
  z.object({
    type: z.literal("provider.network-idle"),
    url: z.string().optional(),
  }),
  z.object({
    type: z.literal("provider.transport"),
    event: providerTransportEventSchema,
  }),
  z.object({
    type: z.literal("provider.debug-snapshot"),
    snapshot: providerDebugSnapshotSchema,
  }),
  z.object({ type: z.literal("adapter.degraded"), reason: z.string() }),
]);

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  provider: providerIdSchema,
  text: z.string().max(100_000),
  attachments: z.array(z.object({
    name: z.string().min(1).max(500),
    localPath: z.string().min(1).max(4_000),
    kind: z.enum(ATTACHMENT_KINDS),
    sizeBytes: z.number().int().nonnegative().max(500 * 1024 * 1024),
  })).max(20).default([]),
  modes: z.array(z.enum(PROVIDER_MODES)).max(10).default([]),
  model: z.string().trim().min(1).max(200).optional(),
}).refine(
  (input) => input.text.trim().length > 0 || input.attachments.length > 0,
  "A message requires text or at least one attachment.",
);

export const conversationIdSchema = z.string().min(1);

export const conversationSearchSchema = z.object({
  query: z.string().trim().max(200),
});

export const conversationPinSchema = z.object({
  conversationId: conversationIdSchema,
  pinned: z.boolean(),
});

export const conversationRenameSchema = z.object({
  conversationId: conversationIdSchema,
  title: z.string().trim().min(1).max(200),
});

export const messageDeleteSchema = z.object({
  conversationId: conversationIdSchema,
  messageId: z.string().min(1),
});

export const messageEditResendSchema = z.object({
  conversationId: conversationIdSchema,
  messageId: z.string().min(1),
  text: z.string().trim().min(1).max(100_000),
});

export const providerLayoutSchema = z.object({
  width: z.number().int().min(320).max(1_200),
});

export const systemPromptCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(50_000),
  provider: providerIdSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const systemPromptUpdateSchema = systemPromptCreateSchema.extend({
  id: z.string().min(1),
});

export const systemPromptIdSchema = z.string().min(1);

export const systemPromptSetForConversationSchema = z.object({
  conversationId: conversationIdSchema,
  systemPromptId: systemPromptIdSchema.nullable(),
});

export const comparisonCreateSchema = z.object({
  providers: z.array(providerIdSchema).min(2).max(4).refine(
    (providers) => new Set(providers).size === providers.length,
    "Providers must be unique.",
  ),
});

export const comparisonSendSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().trim().min(1).max(100_000),
});

export const documentIdSchema = z.string().min(1);

export const conversationSetDocumentsSchema = z.object({
  conversationId: conversationIdSchema,
  documentIds: z.array(documentIdSchema).max(50),
});

export const folderCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).nullable().optional(),
});

export const folderRenameSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const conversationSetFolderSchema = z.object({
  conversationId: conversationIdSchema,
  folderId: z.string().min(1).nullable(),
});

export const conversationSetTagsSchema = z.object({
  conversationId: conversationIdSchema,
  tagIds: z.array(z.string().min(1)).max(30),
});

export const conversationBulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delete"),
    conversationIds: z.array(conversationIdSchema).min(1).max(500),
  }),
  z.object({
    action: z.literal("pin"),
    conversationIds: z.array(conversationIdSchema).min(1).max(500),
    pinned: z.boolean(),
  }),
  z.object({
    action: z.literal("set-folder"),
    conversationIds: z.array(conversationIdSchema).min(1).max(500),
    folderId: z.string().min(1).nullable(),
  }),
  z.object({
    action: z.literal("set-tags"),
    conversationIds: z.array(conversationIdSchema).min(1).max(500),
    tagIds: z.array(z.string().min(1)).max(30),
  }),
  z.object({
    action: z.literal("migrate"),
    conversationIds: z.array(conversationIdSchema).min(1).max(20),
    targetProvider: providerIdSchema,
  }),
]);

export const conversationExportSchema = z.object({
  conversationId: conversationIdSchema,
  format: z.enum(["markdown", "json"]),
});

export const conversationImportSchema = z.object({
  json: z.string().min(1).max(5_000_000),
});

export const appSettingsSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  locale: z.enum(["system", "zh-CN", "en-US"]).optional(),
  defaultProvider: providerIdSchema.nullable().optional(),
  enabledProviders: z.array(providerIdSchema).max(PROVIDER_IDS.length).optional(),
  providerOrder: z.array(providerIdSchema).max(PROVIDER_IDS.length).optional(),
  providerBackends: z.record(
    providerIdSchema,
    z.enum(["web", "api", "manual"]),
  ).optional(),
  providerApiConfigs: z.record(
    providerIdSchema,
    z.object({
      enabled: z.boolean().optional(),
      baseUrl: z.string().url().optional(),
      model: z.string().trim().min(1).max(200).optional(),
    }),
  ).optional(),
  autoSyncWebHistory: z.boolean().optional(),
  uiScale: z.union([
    z.literal(0.9),
    z.literal(1),
    z.literal(1.1),
    z.literal(1.25),
  ]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  contentWidth: z.enum(["narrow", "standard", "wide"]).optional(),
  codeWrap: z.boolean().optional(),
  motion: z.enum(["system", "reduced", "full"]).optional(),
  sidebarWidth: z.number().min(200).max(480).optional(),
  sidebarCollapsed: z.boolean().optional(),
  providerDrawerWidth: z.number().min(320).max(1_200).optional(),
  hasCompletedOnboarding: z.boolean().optional(),
  shortcuts: z.record(z.string(), z.string()).optional(),
});

const compatibleProviderListSchema = z
  .array(z.string())
  .max(100)
  .transform((providers) => providers.filter(isProviderId));

const compatibleProviderBackendsSchema = z
  .record(z.string(), z.enum(["web", "api", "manual"]))
  .transform((entries) =>
    Object.fromEntries(
      Object.entries(entries).filter(([provider]) => isProviderId(provider)),
    ),
  );

const compatibleProviderApiConfigsSchema = z
  .record(
    z.string(),
    z.object({
      enabled: z.boolean().optional(),
      baseUrl: z.string().url().optional(),
      model: z.string().trim().min(1).max(200).optional(),
    }),
  )
  .transform((entries) =>
    Object.fromEntries(
      Object.entries(entries).filter(([provider]) => isProviderId(provider)),
    ),
  );

export const appSettingsCompatibilitySchema = appSettingsSchema.extend({
  defaultProvider: z
    .string()
    .nullable()
    .optional()
    .transform((provider) =>
      provider === undefined
        ? undefined
        : provider !== null && isProviderId(provider)
          ? provider
          : null,
    ),
  enabledProviders: compatibleProviderListSchema.optional(),
  providerOrder: compatibleProviderListSchema.optional(),
  providerBackends: compatibleProviderBackendsSchema.optional(),
  providerApiConfigs: compatibleProviderApiConfigsSchema.optional(),
});

function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.some((provider) => provider === value);
}

export const settingsImportSchema = z.object({
  json: z.string().min(1).max(200_000),
});

export const settingsImportPreviewSchema = z.object({
  candidate: appSettingsSchema,
  changes: z.array(z.object({
    key: z.string().min(1),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })),
  ignoredKeys: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const dataStorageSummarySchema = z.object({
  userDataPath: z.string().min(1),
  databaseBytes: z.number().int().nonnegative(),
  conversationCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
  documentBytes: z.number().int().nonnegative(),
  indexedCharacterCount: z.number().int().nonnegative(),
});

export const dataExportResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().min(1).optional(),
  conversationCount: z.number().int().nonnegative().optional(),
  messageCount: z.number().int().nonnegative().optional(),
});

export const appDataExportV1Schema = z.object({
  format: z.literal("aihub-data"),
  version: z.literal(1),
  appVersion: z.string().min(1),
  exportedAt: z.string().datetime(),
  conversations: z.array(normalizedConversationSchema).superRefine(
    (conversations, context) => {
      conversations.forEach((conversation, conversationIndex) => {
        conversation.messages.forEach((message, messageIndex) => {
          if (
            message.providerHtml &&
            /(?:^|[\s"'(=])(?:file:|[a-z]:[\\/]|\\\\)/i.test(
              message.providerHtml,
            )
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Exported provider HTML must not contain local paths.",
              path: [
                conversationIndex,
                "messages",
                messageIndex,
                "providerHtml",
              ],
            });
          }
          message.content.forEach((block, blockIndex) => {
            if (
              block.type === "attachment" &&
              (block.localPath ||
                /(?:^|[\s"'(=])(?:file:|[a-z]:[\\/]|\\\\)/i.test(block.name))
            ) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Exported attachments must not contain local paths.",
                path: [
                  conversationIndex,
                  "messages",
                  messageIndex,
                  "content",
                  blockIndex,
                  block.localPath ? "localPath" : "name",
                ],
              });
            }
            if (
              block.type === "image" &&
              /(?:^|[\s"'(=])(?:file:|[a-z]:[\\/]|\\\\)/i.test(block.src)
            ) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Exported images must not contain local paths.",
                path: [
                  conversationIndex,
                  "messages",
                  messageIndex,
                  "content",
                  blockIndex,
                  "src",
                ],
              });
            }
            if (
              (block.type === "citation" &&
                /(?:^|[\s"'(=])(?:file:|[a-z]:[\\/]|\\\\)/i.test(block.url)) ||
              (block.type === "html" &&
                /(?:^|[\s"'(=])(?:file:|[a-z]:[\\/]|\\\\)/i.test(block.html))
            ) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Exported content must not contain local paths.",
                path: [
                  conversationIndex,
                  "messages",
                  messageIndex,
                  "content",
                  blockIndex,
                ],
              });
            }
          });
        });
      });
    },
  ),
  folders: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    parentId: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
  })),
  tags: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().min(1),
    createdAt: z.string().datetime(),
  })),
  systemPrompts: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    content: z.string(),
    provider: providerIdSchema.optional(),
    isDefault: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })),
  documents: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })),
});

export const externalUrlSchema = z
  .string()
  .url()
  .refine((url) => {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "Only HTTP(S) URLs are allowed.");

export const transferPreviewSchema = z.object({
  sourceConversationId: conversationIdSchema,
  targetProvider: providerIdSchema,
  compressionProvider: providerIdSchema.nullable().optional(),
});

export const transferConfirmSchema = z.object({
  sourceConversationId: z.string().min(1),
  targetProvider: providerIdSchema,
  compressionProvider: providerIdSchema.nullable().optional(),
  markdown: z.string().min(1).max(120_000),
});

export const insertTextSchema = z.object({
  text: z.string().max(100_000),
});
