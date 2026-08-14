import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyPendingDatabaseRestore,
  BackupService,
} from "../src/main/backup-service";
import { AppDatabase, DATABASE_SCHEMA_VERSION } from "../src/main/database";

let testDir: string;
let database: AppDatabase | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(path.join(os.tmpdir(), "aihub-backup-test-"));
  database = new AppDatabase(path.join(testDir, "aihub.sqlite"));
});

afterEach(async () => {
  database?.close();
  database = undefined;
  await rm(testDir, { recursive: true, force: true });
});

describe("BackupService", () => {
  it("creates a versioned, checksummed SQLite backup", async () => {
    const conversation = database!.createConversation({
      id: "conversation-1",
      title: "Backup source",
      provider: "chatgpt",
    });
    database!.addMessage({
      id: "message-1",
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "Persist me." }],
      status: "completed",
      provider: "chatgpt",
      createdAt: new Date().toISOString(),
    });
    const service = new BackupService(database!, testDir, "0.2.0");

    const result = await service.create("manual", 30);
    const listed = await service.list();

    expect(result.backup.databaseSchemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(result.backup.conversationCount).toBe(1);
    expect(result.backup.messageCount).toBe(1);
    expect(result.backup.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(listed).toEqual([result.backup]);
  });

  it("rejects a corrupt backup before scheduling restore", async () => {
    database!.createConversation({
      id: "current",
      title: "Current data",
      provider: "claude",
    });
    const service = new BackupService(database!, testDir, "0.2.0");
    const created = await service.create("manual", 30);
    await writeFile(
      path.join(testDir, "backups", created.backup.databaseFile),
      "corrupt",
      "utf8",
    );

    await expect(
      service.scheduleRestore(created.backup.id, 30),
    ).rejects.toThrow(/size|checksum|integrity/i);
    expect(database!.getConversation("current")?.title).toBe("Current data");
  });

  it("refuses a backup created by a newer database schema", async () => {
    const service = new BackupService(database!, testDir, "0.2.0");
    const created = await service.create("manual", 30);
    const manifestPath = path.join(
      testDir,
      "backups",
      `${created.backup.id}.json`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      databaseSchemaVersion: number;
    };
    manifest.databaseSchemaVersion = DATABASE_SCHEMA_VERSION + 1;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    await expect(service.previewRestore(created.backup.id)).rejects.toThrow(
      /newer LLM Workbench version/i,
    );
  });

  it("rejects a manifest whose schema version does not match its database", async () => {
    const service = new BackupService(database!, testDir, "0.2.0");
    const created = await service.create("manual", 30);
    const manifestPath = path.join(
      testDir,
      "backups",
      `${created.backup.id}.json`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      databaseSchemaVersion: number;
    };
    manifest.databaseSchemaVersion = Math.max(
      0,
      DATABASE_SCHEMA_VERSION - 1,
    );
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    await expect(service.previewRestore(created.backup.id)).rejects.toThrow(
      /schema does not match/i,
    );
  });

  it("prunes only expired automatic backups under the retention policy", async () => {
    const service = new BackupService(database!, testDir, "0.2.0");
    const scheduled = await service.create("scheduled", 30);
    const manual = await service.create("manual", 30);
    for (const backup of [scheduled.backup, manual.backup]) {
      const manifestPath = path.join(testDir, "backups", `${backup.id}.json`);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        createdAt: string;
      };
      manifest.createdAt = "2020-01-01T00:00:00.000Z";
      await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    }

    await expect(service.pruneScheduled(7)).resolves.toEqual([
      scheduled.backup.id,
    ]);
    await expect(service.list()).resolves.toMatchObject([
      { id: manual.backup.id, reason: "manual" },
    ]);
  });

  it("does not prune an expired automatic backup selected for restore", async () => {
    const service = new BackupService(database!, testDir, "0.2.0");
    const target = await service.create("scheduled", 30);
    const manifestPath = path.join(
      testDir,
      "backups",
      `${target.backup.id}.json`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      createdAt: string;
    };
    manifest.createdAt = "2020-01-01T00:00:00.000Z";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    await service.scheduleRestore(target.backup.id, 7);

    await expect(service.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: target.backup.id }),
        expect.objectContaining({ reason: "pre-restore" }),
      ]),
    );
  });

  it("atomically applies a validated backup on the next startup", async () => {
    database!.createConversation({
      id: "before-backup",
      title: "Before backup",
      provider: "chatgpt",
    });
    const service = new BackupService(database!, testDir, "0.2.0");
    const created = await service.create("manual", 30);
    database!.createConversation({
      id: "after-backup",
      title: "After backup",
      provider: "chatgpt",
    });

    await service.scheduleRestore(created.backup.id, 30);
    database!.close();
    database = undefined;
    await expect(applyPendingDatabaseRestore(testDir)).resolves.toBe(
      created.backup.id,
    );

    database = new AppDatabase(path.join(testDir, "aihub.sqlite"));
    expect(database.getConversation("before-backup")).toBeDefined();
    expect(database.getConversation("after-backup")).toBeUndefined();
  });

  it("removes an invalid pending restore request instead of retrying forever", async () => {
    const backupDir = path.join(testDir, "backups");
    const requestPath = path.join(backupDir, "restore-request.json");
    await mkdir(backupDir, { recursive: true });
    await writeFile(requestPath, "{invalid", "utf8");

    await expect(applyPendingDatabaseRestore(testDir)).rejects.toThrow(
      /not valid JSON/i,
    );
    await expect(readFile(requestPath, "utf8")).rejects.toThrow();
    await expect(applyPendingDatabaseRestore(testDir)).resolves.toBeUndefined();
  });
});
