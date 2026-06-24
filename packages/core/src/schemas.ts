import { z } from "zod";
import { PROVIDER_IDS } from "./types";

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
]);

export const normalizedMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.array(contentBlockSchema),
  status: z.enum(["pending", "streaming", "completed", "failed"]),
  provider: providerIdSchema,
  createdAt: z.string().datetime(),
});

export const providerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth.changed"), authenticated: z.boolean() }),
  z.object({
    type: z.literal("conversation.changed"),
    externalId: z.string().optional(),
  }),
  z.object({ type: z.literal("message.started"), messageId: z.string() }),
  z.object({
    type: z.literal("message.delta"),
    messageId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("message.completed"),
    message: normalizedMessageSchema,
  }),
  z.object({
    type: z.literal("generation.failed"),
    code: z.string(),
    recoverable: z.boolean(),
  }),
  z.object({ type: z.literal("adapter.degraded"), reason: z.string() }),
]);

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  provider: providerIdSchema,
  text: z.string().trim().min(1).max(100_000),
});

export const conversationIdSchema = z.string().min(1);

export const transferConfirmSchema = z.object({
  sourceConversationId: z.string().min(1),
  markdown: z.string().min(1).max(120_000),
});
