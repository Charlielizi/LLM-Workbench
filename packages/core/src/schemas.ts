import { z } from "zod";
import {
  ATTACHMENT_KINDS,
  PROVIDER_IDS,
  PROVIDER_MODES,
  type ProviderSendPhase,
} from "./types";

export const providerIdSchema = z.enum(PROVIDER_IDS);

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
  provider: providerIdSchema,
  createdAt: z.string().datetime(),
});

export const normalizedConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  provider: providerIdSchema,
  externalId: z.string().optional(),
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

export const providerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.changed"), authenticated: z.boolean() }),
  z.object({
    type: z.literal("conversation.changed"),
    externalId: z.string().optional(),
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
  defaultProvider: providerIdSchema.nullable().optional(),
  sidebarWidth: z.number().min(200).max(480).optional(),
  sidebarCollapsed: z.boolean().optional(),
  providerDrawerWidth: z.number().min(320).max(1_200).optional(),
  hasCompletedOnboarding: z.boolean().optional(),
  shortcuts: z.record(z.string(), z.string()).optional(),
});

export const settingsImportSchema = z.object({
  json: z.string().min(1).max(200_000),
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
