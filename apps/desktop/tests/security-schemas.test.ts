import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appSnapshotSchema,
  conversationPinSchema,
  conversationRenameSchema,
  conversationSearchSchema,
  messageDeleteSchema,
  messageEditResendSchema,
  comparisonCreateSchema,
  providerLayoutSchema,
  systemPromptCreateSchema,
  transferPreviewSchema,
  appSettingsSchema,
  providerSmokeTestRequestSchema,
  providerSmokeTestResultSchema,
  conversationBulkActionSchema,
  conversationSetDocumentsSchema,
  tagCreateSchema,
  providerEventSchema,
  providerInteractionTargetSchema,
  providerSubmitEvidenceSchema,
  providerTextVerificationSchema,
  providerTransportEventSchema,
  providerAdapterEventsQuerySchema,
  providerCleanModeSchema,
  providerDebugDumpSchema,
  currentWebConversationSyncResultSchema,
  sendMessageSchema,
  transferConfirmSchema,
} from "@aihub/core";

describe("trusted IPC schemas", () => {
  it("validates current website conversation sync results", () => {
    expect(
      currentWebConversationSyncResultSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        created: true,
        syncedMessages: 12,
        partial: false,
        syncedAt: "2026-07-25T12:00:00.000Z",
      }),
    ).toMatchObject({
      provider: "chatgpt",
      conversationId: "conversation",
      syncedMessages: 12,
    });
    expect(() =>
      currentWebConversationSyncResultSchema.parse({
        provider: "unknown",
        conversationId: "",
        created: "yes",
        syncedMessages: -1,
        partial: false,
        syncedAt: "today",
      }),
    ).toThrow();
  });

  it("rejects unknown providers and empty messages", () => {
    expect(() =>
      sendMessageSchema.parse({
        provider: "unknown",
        conversationId: "conversation",
        text: "hello",
      }),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: " ",
      }),
    ).toThrow();
  });

  it("validates provider adapter event query bounds", () => {
    expect(
      providerAdapterEventsQuerySchema.parse({
        provider: "chatgpt",
        limit: 25,
      }),
    ).toEqual({
      provider: "chatgpt",
      limit: 25,
    });
    expect(() =>
      providerAdapterEventsQuerySchema.parse({
        provider: "unknown",
        limit: 25,
      }),
    ).toThrow();
    expect(() =>
      providerAdapterEventsQuerySchema.parse({
        provider: "chatgpt",
        limit: 501,
      }),
    ).toThrow();
  });

  it("validates clean mode commands without coercing booleans", () => {
    expect(
      providerCleanModeSchema.parse({
        provider: "chatgpt",
        enabled: false,
      }),
    ).toEqual({
      provider: "chatgpt",
      enabled: false,
    });
    expect(() =>
      providerCleanModeSchema.parse({
        provider: "chatgpt",
        enabled: "false",
      }),
    ).toThrow();
    expect(() =>
      providerCleanModeSchema.parse({
        provider: "unknown",
        enabled: true,
      }),
    ).toThrow();
  });

  it("accepts all supported Chinese provider ids", () => {
    for (const provider of [
      "doubao",
      "kimi",
      "deepseek",
      "hunyuan",
      "qianwen",
    ]) {
      expect(
        sendMessageSchema.parse({
          provider,
          conversationId: "conversation",
          text: "hello",
        }).provider,
      ).toBe(provider);
    }
  });

  it("accepts attachment-only and multimodal send requests", () => {
    const attachment = {
      localPath: "C:\\Users\\li\\Pictures\\sample.png",
      name: "sample.png",
      kind: "image",
      sizeBytes: 1024,
    };
    expect(
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "",
        attachments: [attachment],
        modes: ["reasoning", "web-search"],
        model: "GPT-5",
      }).attachments,
    ).toEqual([attachment]);
    expect(
      sendMessageSchema.parse({
        provider: "claude",
        conversationId: "conversation",
        text: "Analyze this image.",
        attachments: [attachment],
      }).text,
    ).toBe("Analyze this image.");
  });

  it("rejects empty sends and invalid multimodal metadata", () => {
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "",
        attachments: [],
      }),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "hello",
        modes: ["unsupported-mode"],
      }),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse({
        provider: "chatgpt",
        conversationId: "conversation",
        text: "",
        attachments: [{
          localPath: "",
          name: "sample.png",
          kind: "image",
          sizeBytes: -1,
        }],
      }),
    ).toThrow();
  });

  it("rejects arbitrary provider bridge messages", () => {
    expect(() =>
      providerEventSchema.parse({
        type: "execute-script",
        code: "require('fs')",
      }),
    ).toThrow();
  });

  it("keeps provider network monitoring away from response body parsing", () => {
    const preload = readFileSync(
      path.join(import.meta.dirname, "..", "src", "provider-preload.ts"),
      "utf8",
    );

    expect(preload).not.toContain("response.clone()");
    expect(preload).not.toContain(".getReader()");
    expect(preload).not.toContain("reader.read()");
  });

  it("accepts provider-completed messages with captured provider html", () => {
    const parsed = providerEventSchema.parse({
      type: "message.completed",
      message: {
        id: "message",
        conversationId: "conversation",
        role: "assistant",
        content: [{ type: "text", text: "Answer" }],
        providerHtml: "<div class='markdown'><p>Answer</p></div>",
        status: "completed",
        provider: "chatgpt",
        createdAt: new Date().toISOString(),
      },
    });

    expect(parsed.type).toBe("message.completed");
    if (parsed.type !== "message.completed") {
      throw new Error("Expected a completed provider event.");
    }
    expect(parsed.message.providerHtml).toContain("<p>Answer</p>");
  });

  it("accepts provider snapshot events with html", () => {
    const parsed = providerEventSchema.parse({
      type: "message.snapshot",
      messageId: "message",
      content: [
        { type: "text", text: "partial answer" },
        {
          type: "math",
          tex: "x^2+y^2",
          display: false,
          source: "katex",
        },
        {
          type: "html",
          kind: "provider-assistant",
          html: "<div><p>partial answer</p></div>",
        },
      ],
      text: "partial answer",
      providerHtml: "<div><p>partial answer</p></div>",
    });

    expect(parsed.type).toBe("message.snapshot");
    if (parsed.type !== "message.snapshot") {
      throw new Error("Expected a snapshot provider event.");
    }
    expect(parsed.providerHtml).toContain("partial answer");
    expect(parsed.content[1]).toMatchObject({
      type: "math",
      tex: "x^2+y^2",
    });
  });

  it("accepts provider generation failures tied to a provider message id", () => {
    const parsed = providerEventSchema.parse({
      type: "generation.failed",
      messageId: "provider-message",
      code: "provider_response_not_detected",
      recoverable: true,
      phase: "waiting-first-token",
      detail: "No assistant response was detected.",
    });

    expect(parsed).toMatchObject({
      type: "generation.failed",
      messageId: "provider-message",
      code: "provider_response_not_detected",
    });
  });

  it("validates structured provider debug completion signals", () => {
    const event = {
      type: "provider.debug-snapshot",
      snapshot: {
        provider: "chatgpt",
        url: "https://chatgpt.com/c/123",
        composer: "textarea visible=true text=0",
        submit: "button visible=true text=4",
        anchor: "div:assistant:3",
        assistant: "div visible=true text=42",
        activeMessageId: "provider-message",
        assistantBinding: "bound-after-anchor:3->4",
        latestTextLength: 42,
        isGenerating: false,
        networkActiveCount: 0,
        networkIdle: true,
        lastNetworkUrl: "https://chatgpt.com/backend-api/conversation",
        lastMutationAt: 123,
        completionDecision: "complete text=42 stop=false streaming=false network=idle",
        completionSignals: {
          textLength: 42,
          hasStopButton: false,
          hasStreamingIndicator: false,
          networkIdle: true,
          hasRecoverableBlocker: false,
          recoverableBlockerReason: undefined,
          stableMs: 3000,
          elapsedMs: 5000,
        },
        fallbackUsed: false,
      },
    };

    expect(providerEventSchema.parse(event)).toMatchObject(event);
    expect(() =>
      providerEventSchema.parse({
        ...event,
        snapshot: {
          ...event.snapshot,
          completionSignals: undefined,
        },
      }),
    ).toThrow();
  });

  it("accepts provider summaries with optional failure diagnostics", () => {
    expect(appSnapshotSchema.parse({
      providers: [{
        id: "chatgpt",
        authenticated: false,
        ready: false,
        degraded: false,
        reason: "Login required",
        lastFailurePhase: "checking-auth",
        lastFailureCode: "auth_required",
        websiteVisible: true,
      }],
      conversations: [],
      comparisons: [],
    }).providers[0]).toMatchObject({
      id: "chatgpt",
      lastFailurePhase: "checking-auth",
      lastFailureCode: "auth_required",
    });
  });

  it("validates provider smoke request and result payloads", () => {
    expect(
      providerSmokeTestRequestSchema.parse({
        provider: "chatgpt",
        scenario: "manual-recovery",
        targetRuntimeInstanceId: "runtime-123",
      }),
    ).toMatchObject({
      provider: "chatgpt",
      scenario: "manual-recovery",
    });
    expect(() =>
      providerSmokeTestRequestSchema.parse({
        provider: "unknown",
      }),
    ).toThrow();
    expect(
      providerSmokeTestRequestSchema.parse({
        provider: "doubao",
        scenario: "background-send",
      }),
    ).toMatchObject({
      provider: "doubao",
      scenario: "background-send",
    });

    const now = new Date().toISOString();
    expect(
      providerSmokeTestResultSchema.parse({
        provider: "chatgpt",
        scenario: "manual-recovery",
        token: "AIHUB_CHATGPT_123",
        sendError: null,
        assistantMessage: {
          id: "assistant",
          conversationId: "conversation",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          status: "completed",
          statusPhase: "completed",
          provider: "chatgpt",
          createdAt: now,
        },
        diagnostics: {
          providerSummary: {
            id: "chatgpt",
            authenticated: true,
            ready: true,
            degraded: false,
            websiteVisible: true,
          },
          debugSnapshot: {
            provider: "chatgpt",
            url: "https://chatgpt.com/c/123",
            composer: "textarea",
            submit: "button",
            anchor: "div:3",
            assistant: "div:4",
            latestTextLength: 4,
            isGenerating: false,
            networkActiveCount: 0,
            networkIdle: true,
            lastMutationAt: 10,
            completionDecision: "complete",
            completionSignals: {
              textLength: 4,
              hasStopButton: false,
              hasStreamingIndicator: false,
              networkIdle: true,
              hasRecoverableBlocker: false,
              stableMs: 100,
              elapsedMs: 200,
            },
            fallbackUsed: false,
          },
          adapterEvents: [{
            id: 1,
            provider: "chatgpt",
            type: "provider.network-idle",
            createdAt: now,
          }],
        },
      }),
    ).toMatchObject({
      provider: "chatgpt",
      scenario: "manual-recovery",
    });
    expect(() =>
      providerSmokeTestResultSchema.parse({
        provider: "chatgpt",
        diagnostics: {
          adapterEvents: [{
            id: -1,
            provider: "chatgpt",
            type: "provider.network-idle",
            createdAt: now,
          }],
        },
      }),
    ).toThrow();
  });

  it("rejects malformed app snapshots from the trusted bridge", () => {
    expect(() =>
      appSnapshotSchema.parse({
        providers: [{
          id: "chatgpt",
          authenticated: false,
          ready: false,
          degraded: false,
          websiteVisible: "yes",
        }],
        conversations: [],
        comparisons: [],
      }),
    ).toThrow();
    expect(() =>
      appSnapshotSchema.parse({
        providers: [],
        conversations: [],
        comparisons: [{
          id: "session",
          title: "Compare",
          participants: [{ conversationId: "conversation", provider: "unknown" }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      }),
    ).toThrow();
  });

  it("bounds transfer payload size", () => {
    expect(() =>
      transferConfirmSchema.parse({
        sourceConversationId: "conversation",
        markdown: "x".repeat(120_001),
      }),
    ).toThrow();
  });

  it("validates conversation management payloads", () => {
    expect(
      conversationSearchSchema.parse({ query: "database" }).query,
    ).toBe("database");
    expect(() =>
      conversationSearchSchema.parse({ query: "x".repeat(201) }),
    ).toThrow();
    expect(() =>
      conversationRenameSchema.parse({
        conversationId: "conversation",
        title: " ",
      }),
    ).toThrow();
    expect(
      conversationPinSchema.parse({
        conversationId: "conversation",
        pinned: true,
      }).pinned,
    ).toBe(true);
  });

  it("validates message mutation payloads", () => {
    expect(
      messageDeleteSchema.parse({
        conversationId: "conversation",
        messageId: "message",
      }).messageId,
    ).toBe("message");
    expect(() =>
      messageEditResendSchema.parse({
        conversationId: "conversation",
        messageId: "message",
        text: " ",
      }),
    ).toThrow();
  });

  it("validates provider layout, prompts, transfers, and comparisons", () => {
    expect(providerLayoutSchema.parse({
      surfaceVisible: true,
      x: 0.6,
      y: 0.1,
      width: 0.4,
      height: 0.9,
    }).width).toBe(0.4);
    expect(() => providerLayoutSchema.parse({
      surfaceVisible: true,
      x: 0.8,
      y: 0.1,
      width: 0.4,
      height: 0.9,
    })).toThrow();
    expect(() => providerLayoutSchema.parse({
      surfaceVisible: true,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })).toThrow();
    expect(providerDebugDumpSchema.parse("redacted diagnostics")).toBe(
      "redacted diagnostics",
    );
    expect(() => providerDebugDumpSchema.parse("x".repeat(1_000_001)))
      .toThrow();
    expect(
      systemPromptCreateSchema.parse({
        name: "Concise",
        content: "Be concise.",
      }).name,
    ).toBe("Concise");
    expect(
      transferPreviewSchema.parse({
        sourceConversationId: "source",
        targetProvider: "doubao",
      }).targetProvider,
    ).toBe("doubao");
    expect(() =>
      comparisonCreateSchema.parse({
        providers: ["chatgpt", "chatgpt"],
      }),
    ).toThrow();
  });

  it("validates knowledge, organization, and settings payloads", () => {
    expect(
      conversationSetDocumentsSchema.parse({
        conversationId: "conversation",
        documentIds: ["document"],
      }).documentIds,
    ).toEqual(["document"]);
    expect(
      tagCreateSchema.parse({ name: "Research", color: "#7ce6ae" }).color,
    ).toBe("#7ce6ae");
    expect(() =>
      conversationBulkActionSchema.parse({
        action: "migrate",
        conversationIds: [],
        targetProvider: "claude",
      }),
    ).toThrow();
    expect(appSettingsSchema.parse({ theme: "system" }).theme).toBe("system");
    expect(
      appSettingsSchema.parse({
        providerBackends: { chatgpt: "api" },
        providerApiConfigs: {
          chatgpt: {
            enabled: true,
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4.1",
          },
        },
      }).providerApiConfigs?.chatgpt?.model,
    ).toBe("gpt-4.1");
    expect(() =>
      appSettingsSchema.parse({
        providerApiConfigs: {
          chatgpt: {
            baseUrl: "not-a-url",
          },
        },
      }),
    ).toThrow();
  });

  it("validates trusted interaction and redacted transport evidence", () => {
    expect(providerInteractionTargetSchema.parse({
      action: "composer",
      inputMethod: "text",
      x: 120,
      y: 300,
      width: 480,
      height: 64,
      elementType: "contenteditable",
      fingerprint: "fnv1a-12345678",
    }).action).toBe("composer");
    expect(providerTextVerificationSchema.parse({
      matched: true,
      actualLength: 12,
      expectedLength: 12,
      actualHash: "fnv1a-a",
      expectedHash: "fnv1a-a",
      fingerprint: "fnv1a-target",
    }).matched).toBe(true);
    expect(providerSubmitEvidenceSchema.parse({
      confirmed: true,
      userTurnSeen: false,
      transportSeen: true,
      assistantStarted: false,
      sessionCreated: false,
      retryAllowed: false,
    }).transportSeen).toBe(true);
    expect(providerTransportEventSchema.parse({
      requestId: "42",
      phase: "completed",
      urlPath: "https://chat.example/completion",
      method: "POST",
      statusCode: 200,
      durationMs: 450,
      resourceType: "sharedWorker",
      uploadBytes: 128,
      uploadHash: "sha256-redacted",
      markerObserved: true,
    }).resourceType).toBe("sharedWorker");
    const stripped = providerTransportEventSchema.parse({
      requestId: "42",
      phase: "completed",
      urlPath: "https://chat.example/completion",
      method: "POST",
      requestHeaders: { cookie: "secret" },
    });
    expect(stripped).not.toHaveProperty("requestHeaders");
  });

});
