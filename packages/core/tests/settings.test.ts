import { describe, expect, it } from "vitest";
import {
  PROVIDER_IDS,
  appDataExportV1Schema,
  appSettingsCompatibilitySchema,
  normalizeAppSettings,
  type AppDataExportV1,
  type ProviderId,
} from "../src";

describe("normalizeAppSettings", () => {
  it("fills new fields for legacy settings", () => {
    const settings = normalizeAppSettings({
      theme: "dark",
      sidebarWidth: 320,
    });

    expect(settings.theme).toBe("dark");
    expect(settings.locale).toBe("system");
    expect(settings.uiScale).toBe(1);
    expect(settings.providerOrder).toEqual(PROVIDER_IDS);
    expect(settings.enabledProviders).toEqual(PROVIDER_IDS);
    expect(settings.contrastMode).toBe("system");
    expect(settings.automaticBackup).toBe(true);
    expect(settings.backupRetentionDays).toBe(30);
    expect(settings.trashRetentionDays).toBe(30);
    expect(settings.trayEnabled).toBe(true);
    expect(settings.closeBehavior).toBe("exit");
    expect(settings.launchAtLogin).toBe(false);
    expect(settings.notificationPreferences).toEqual({
      generationCompleted: true,
      generationFailed: true,
      syncFailed: true,
      showPreview: false,
    });
    expect(settings.updatePolicy).toBe("notify");
  });

  it("repairs provider order, enabled providers, and default provider", () => {
    const settings = normalizeAppSettings({
      providerOrder: [
        "claude",
        "chatgpt",
        "claude",
        "unknown",
      ] as unknown as ProviderId[],
      enabledProviders: ["deepseek", "claude"],
      defaultProvider: "chatgpt",
    });

    expect(settings.providerOrder.slice(0, 2)).toEqual([
      "claude",
      "chatgpt",
    ]);
    expect(new Set(settings.providerOrder)).toEqual(new Set(PROVIDER_IDS));
    expect(settings.enabledProviders).toEqual(["claude", "deepseek"]);
    expect(settings.defaultProvider).toBe("claude");
  });

  it("restores all providers when the enabled list is empty", () => {
    const settings = normalizeAppSettings({
      providerOrder: ["kimi", "chatgpt"],
      enabledProviders: [],
    });

    expect(settings.enabledProviders).toEqual(settings.providerOrder);
    expect(settings.defaultProvider).toBe("kimi");
  });
});

describe("appSettingsCompatibilitySchema", () => {
  it("filters future provider IDs before normalization", () => {
    const compatible = appSettingsCompatibilitySchema.parse({
      defaultProvider: "future-provider",
      providerOrder: [
        "future-provider",
        "claude",
        "claude",
        "chatgpt",
        "chatgpt",
        "chatgpt",
        "chatgpt",
        "chatgpt",
      ],
      enabledProviders: ["future-provider", "claude"],
      providerBackends: {
        "future-provider": "web",
        claude: "web",
      },
    });
    const settings = normalizeAppSettings(compatible);

    expect(settings.providerOrder.slice(0, 2)).toEqual([
      "claude",
      "chatgpt",
    ]);
    expect(settings.enabledProviders).toEqual(["claude"]);
    expect(settings.defaultProvider).toBe("claude");
    expect(settings.providerBackends).toEqual({ claude: "web" });
  });
});

describe("appDataExportV1Schema", () => {
  const timestamp = "2026-07-25T00:00:00.000Z";
  const basePayload: AppDataExportV1 = {
    format: "aihub-data",
    version: 1,
    appVersion: "0.1.0",
    exportedAt: timestamp,
    conversations: [
      {
        id: "conversation-1",
        title: "Private attachment",
        provider: "chatgpt",
        hidden: false,
        pinned: false,
        documentIds: [],
        tagIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: "message-1",
            conversationId: "conversation-1",
            role: "user",
            content: [{ type: "attachment", name: "notes.txt" }],
            status: "completed",
            provider: "chatgpt",
            createdAt: timestamp,
          },
        ],
      },
    ],
    folders: [],
    tags: [],
    systemPrompts: [],
    documents: [
      {
        id: "document-1",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 12,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };

  it("accepts the versioned export shape without document content or paths", () => {
    expect(appDataExportV1Schema.parse(basePayload)).toEqual(basePayload);
    expect(JSON.stringify(basePayload)).not.toContain("filePath");
    expect(JSON.stringify(basePayload)).not.toContain("localPath");
  });

  it("rejects attachment local paths", () => {
    const payload = structuredClone(basePayload);
    payload.conversations[0]!.messages[0]!.content = [
      {
        type: "attachment",
        name: "notes.txt",
        localPath: "C:\\Users\\person\\notes.txt",
      },
    ];

    expect(() => appDataExportV1Schema.parse(payload)).toThrow(
      "must not contain local paths",
    );
  });

  it("rejects local paths embedded in provider HTML", () => {
    const payload = structuredClone(basePayload);
    payload.conversations[0]!.messages[0]!.providerHtml =
      '<img src="file:///C:/Users/person/private.png">';

    expect(() => appDataExportV1Schema.parse(payload)).toThrow(
      "provider HTML must not contain local paths",
    );
  });

  it("rejects duplicate IDs and messages whose parent metadata does not match", () => {
    const duplicate = structuredClone(basePayload);
    duplicate.conversations.push(structuredClone(duplicate.conversations[0]!));
    expect(() => appDataExportV1Schema.parse(duplicate)).toThrow(
      "Conversation IDs must be unique",
    );

    const wrongParent = structuredClone(basePayload);
    wrongParent.conversations[0]!.messages[0]!.conversationId =
      "another-conversation";
    expect(() => appDataExportV1Schema.parse(wrongParent)).toThrow(
      "must match its parent conversation",
    );

    const wrongProvider = structuredClone(basePayload);
    wrongProvider.conversations[0]!.messages[0]!.provider = "claude";
    expect(() => appDataExportV1Schema.parse(wrongProvider)).toThrow(
      "must match its parent conversation",
    );
  });

  it("rejects unsafe external IDs, missing relationships, and folder cycles", () => {
    const unsafeExternal = structuredClone(basePayload);
    unsafeExternal.conversations[0]!.externalId =
      "file:///C:/Users/person/private.html";
    expect(() => appDataExportV1Schema.parse(unsafeExternal)).toThrow(
      "externalId must be an HTTPS URL",
    );

    const missingTag = structuredClone(basePayload);
    missingTag.conversations[0]!.tagIds = ["missing-tag"];
    expect(() => appDataExportV1Schema.parse(missingTag)).toThrow(
      "must reference exported tags",
    );

    const cycle = structuredClone(basePayload);
    cycle.folders = [
      {
        id: "folder-a",
        name: "A",
        parentId: "folder-b",
        createdAt: timestamp,
      },
      {
        id: "folder-b",
        name: "B",
        parentId: "folder-a",
        createdAt: timestamp,
      },
    ];
    expect(() => appDataExportV1Schema.parse(cycle)).toThrow(
      "must not contain a cycle",
    );
  });

  it("rejects multiple default prompts in the same provider scope", () => {
    const duplicateDefaults = structuredClone(basePayload);
    duplicateDefaults.systemPrompts = [
      {
        id: "prompt-a",
        name: "A",
        content: "A",
        provider: "chatgpt",
        isDefault: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "prompt-b",
        name: "B",
        content: "B",
        provider: "chatgpt",
        isDefault: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];

    expect(() => appDataExportV1Schema.parse(duplicateDefaults)).toThrow(
      "Only one default system prompt is allowed per provider scope",
    );
  });
});
