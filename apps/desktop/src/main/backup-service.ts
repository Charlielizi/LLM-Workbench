import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  backupManifestV1Schema,
  type BackupCreateResult,
  type BackupManifestV1,
  type BackupReason,
  type BackupRestorePreview,
} from "@aihub/core";
import { AppDatabase, DATABASE_SCHEMA_VERSION } from "./database";

const BACKUP_DIRECTORY = "backups";
const RESTORE_REQUEST_FILE = "restore-request.json";

interface RestoreRequest {
  backupId: string;
  databaseFile: string;
  sha256: string;
  requestedAt: string;
}

interface DatabaseInspection {
  schemaVersion: number;
  conversationCount: number;
  messageCount: number;
  documentCount: number;
}

export class BackupService {
  private readonly backupDir: string;

  constructor(
    private readonly database: AppDatabase,
    userDataDir: string,
    private readonly appVersion: string,
  ) {
    this.backupDir = path.join(userDataDir, BACKUP_DIRECTORY);
  }

  async list(): Promise<BackupManifestV1[]> {
    await mkdir(this.backupDir, { recursive: true });
    const entries = await readdir(this.backupDir, { withFileTypes: true });
    const manifests = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            entry.name !== RESTORE_REQUEST_FILE,
        )
        .map(async (entry) => {
          try {
            const raw = await readFile(
              path.join(this.backupDir, entry.name),
              "utf8",
            );
            return backupManifestV1Schema.parse(JSON.parse(raw));
          } catch {
            return undefined;
          }
        }),
    );
    return manifests
      .filter((manifest): manifest is BackupManifestV1 => Boolean(manifest))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async create(
    reason: BackupReason,
    retentionDays: number,
    protectedIds: string[] = [],
  ): Promise<BackupCreateResult> {
    await mkdir(this.backupDir, { recursive: true });
    const id = randomUUID();
    const databaseFile = `${id}.sqlite`;
    const finalDatabasePath = path.join(this.backupDir, databaseFile);
    const temporaryDatabasePath = `${finalDatabasePath}.tmp`;
    const manifestPath = path.join(this.backupDir, `${id}.json`);
    const temporaryManifestPath = `${manifestPath}.tmp`;
    let manifest: BackupManifestV1;
    try {
      await this.database.backupTo(temporaryDatabasePath);
      const inspection = inspectDatabase(temporaryDatabasePath);
      assertDatabaseIntegrity(temporaryDatabasePath);
      const databaseBytes = (await stat(temporaryDatabasePath)).size;
      manifest = backupManifestV1Schema.parse({
        format: "aihub-backup",
        version: 1,
        id,
        appVersion: this.appVersion,
        databaseSchemaVersion: inspection.schemaVersion,
        createdAt: new Date().toISOString(),
        reason,
        databaseFile,
        databaseBytes,
        sha256: await hashFile(temporaryDatabasePath),
        conversationCount: inspection.conversationCount,
        messageCount: inspection.messageCount,
        documentCount: inspection.documentCount,
      });
      await rename(temporaryDatabasePath, finalDatabasePath);
      await writeFile(
        temporaryManifestPath,
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
      await rename(temporaryManifestPath, manifestPath);
    } catch (error) {
      await Promise.all([
        rm(temporaryDatabasePath, { force: true }),
        rm(temporaryManifestPath, { force: true }),
        rm(finalDatabasePath, { force: true }),
        rm(manifestPath, { force: true }),
      ]);
      throw error;
    }
    let prunedIds: string[] = [];
    try {
      prunedIds = await this.pruneScheduled(retentionDays, [
        id,
        ...protectedIds,
      ]);
    } catch (error) {
      console.warn("Scheduled backup retention cleanup failed:", error);
    }
    return { backup: manifest, prunedIds };
  }

  async delete(backupId: string): Promise<void> {
    const manifest = await this.get(backupId);
    await Promise.all([
      rm(path.join(this.backupDir, `${manifest.id}.json`), { force: true }),
      rm(path.join(this.backupDir, manifest.databaseFile), { force: true }),
    ]);
  }

  async previewRestore(backupId: string): Promise<BackupRestorePreview> {
    const backup = await this.get(backupId);
    assertSupportedSchemaVersion(backup.databaseSchemaVersion);
    await verifyBackupFile(backup, this.resolveDatabasePath(backup));
    const currentMetrics = this.database.getStorageMetrics();
    return {
      backup,
      current: {
        conversationCount: currentMetrics.conversationCount,
        messageCount: currentMetrics.messageCount,
        documentCount: currentMetrics.documentCount,
      },
      warnings: [
        "Provider website cookies and login state are not part of this backup and will remain unchanged.",
        "Restoring replaces all LLM Workbench local conversations, settings, prompts, and knowledge content.",
      ],
      requiresRestart: true,
    };
  }

  async scheduleRestore(
    backupId: string,
    retentionDays: number,
  ): Promise<BackupManifestV1> {
    const target = await this.get(backupId);
    assertSupportedSchemaVersion(target.databaseSchemaVersion);
    await verifyBackupFile(target, this.resolveDatabasePath(target));
    await this.create("pre-restore", retentionDays, [target.id]);
    const request: RestoreRequest = {
      backupId: target.id,
      databaseFile: target.databaseFile,
      sha256: target.sha256,
      requestedAt: new Date().toISOString(),
    };
    const requestPath = path.join(this.backupDir, RESTORE_REQUEST_FILE);
    const temporaryRequestPath = `${requestPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryRequestPath,
        JSON.stringify(request, null, 2),
        "utf8",
      );
      await rename(temporaryRequestPath, requestPath);
    } catch (error) {
      await rm(temporaryRequestPath, { force: true });
      throw error;
    }
    return target;
  }

  async hasRecentScheduledBackup(
    maxAgeMs = 24 * 60 * 60 * 1_000,
  ): Promise<boolean> {
    const latest = (await this.list()).find(
      (backup) => backup.reason === "scheduled",
    );
    return Boolean(
      latest && Date.now() - new Date(latest.createdAt).getTime() < maxAgeMs,
    );
  }

  async pruneScheduled(
    retentionDays: number,
    keepIds: string[] = [],
  ): Promise<string[]> {
    const protectedIds = new Set(keepIds);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
    const expired = (await this.list()).filter(
      (backup) =>
        !protectedIds.has(backup.id) &&
        backup.reason === "scheduled" &&
        new Date(backup.createdAt).getTime() < cutoff,
    );
    await Promise.all(expired.map((backup) => this.delete(backup.id)));
    return expired.map((backup) => backup.id);
  }

  private async get(backupId: string): Promise<BackupManifestV1> {
    const manifestPath = path.join(this.backupDir, `${backupId}.json`);
    const raw = await readFile(manifestPath, "utf8").catch(() => {
      throw new Error("Backup was not found.");
    });
    const manifest = backupManifestV1Schema.parse(JSON.parse(raw));
    if (manifest.id !== backupId) throw new Error("Backup manifest ID mismatch.");
    return manifest;
  }

  private resolveDatabasePath(manifest: BackupManifestV1): string {
    const resolved = path.resolve(this.backupDir, manifest.databaseFile);
    if (path.dirname(resolved) !== path.resolve(this.backupDir)) {
      throw new Error("Backup database path is outside the backup directory.");
    }
    return resolved;
  }

}

export async function applyPendingDatabaseRestore(
  userDataDir: string,
): Promise<string | undefined> {
  const backupDir = path.join(userDataDir, BACKUP_DIRECTORY);
  const requestPath = path.join(backupDir, RESTORE_REQUEST_FILE);
  let raw: string;
  try {
    raw = await readFile(requestPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
  let request: RestoreRequest;
  try {
    request = JSON.parse(raw) as RestoreRequest;
  } catch (error) {
    await rm(requestPath, { force: true });
    throw new Error("Pending restore request is not valid JSON.", {
      cause: error,
    });
  }
  if (
    typeof request.backupId !== "string" ||
    typeof request.databaseFile !== "string" ||
    typeof request.sha256 !== "string"
  ) {
    await rm(requestPath, { force: true });
    throw new Error("Pending restore request is invalid.");
  }
  const sourcePath = path.resolve(backupDir, request.databaseFile);
  if (path.dirname(sourcePath) !== path.resolve(backupDir)) {
    await rm(requestPath, { force: true });
    throw new Error("Pending restore source is outside the backup directory.");
  }
  try {
    if ((await hashFile(sourcePath)) !== request.sha256) {
      throw new Error("Pending restore backup checksum does not match.");
    }
    assertDatabaseIntegrity(sourcePath);
    assertSupportedSchemaVersion(inspectDatabase(sourcePath).schemaVersion);
  } catch (error) {
    await rm(requestPath, { force: true });
    throw error;
  }

  const databasePath = path.join(userDataDir, "aihub.sqlite");
  const temporaryPath = path.join(
    userDataDir,
    `aihub.restore-${request.backupId}.tmp`,
  );
  const replacedPath = path.join(
    userDataDir,
    `aihub.replaced-${request.backupId}.sqlite`,
  );
  await copyFile(sourcePath, temporaryPath);
  try {
    await rm(replacedPath, { force: true });
    await rename(databasePath, replacedPath).catch((error: unknown) => {
      if (isMissingFile(error)) return;
      throw error;
    });
    await rename(temporaryPath, databasePath);
    await Promise.all([
      rm(`${databasePath}-wal`, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
      rm(replacedPath, { force: true }),
      rm(requestPath, { force: true }),
    ]);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    const databaseExists = await stat(databasePath)
      .then(() => true)
      .catch(() => false);
    if (!databaseExists) {
      await rename(replacedPath, databasePath).catch(() => undefined);
    }
    throw error;
  }
  return request.backupId;
}

function inspectDatabase(databasePath: string): DatabaseInspection {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const schema = database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return {
      schemaVersion: schema.user_version,
      conversationCount: countTable(database, "conversations"),
      messageCount: countTable(database, "messages"),
      documentCount: countTable(database, "documents"),
    };
  } finally {
    database.close();
  }
}

function assertDatabaseIntegrity(databasePath: string): void {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = (
      database.prepare("PRAGMA integrity_check").all() as Array<{
        integrity_check: string;
      }>
    ).map((row) => row.integrity_check);
    if (integrity.some((entry) => entry !== "ok")) {
      throw new Error(`Backup integrity check failed: ${integrity.join("; ")}`);
    }
  } finally {
    database.close();
  }
}

function countTable(database: DatabaseSync, table: string): number {
  const exists = database
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table) as { present: number } | undefined;
  if (!exists) return 0;
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}

async function verifyBackupFile(
  manifest: BackupManifestV1,
  databasePath: string,
): Promise<void> {
  const file = await stat(databasePath).catch(() => {
    throw new Error("Backup database file was not found.");
  });
  if (file.size !== manifest.databaseBytes) {
    throw new Error("Backup database size does not match its manifest.");
  }
  if ((await hashFile(databasePath)) !== manifest.sha256) {
    throw new Error("Backup database checksum does not match its manifest.");
  }
  assertDatabaseIntegrity(databasePath);
  const inspection = inspectDatabase(databasePath);
  if (inspection.schemaVersion !== manifest.databaseSchemaVersion) {
    throw new Error(
      "Backup database schema does not match its manifest.",
    );
  }
  assertSupportedSchemaVersion(inspection.schemaVersion);
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function assertSupportedSchemaVersion(schemaVersion: number): void {
  if (schemaVersion > DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `Backup schema ${schemaVersion} requires a newer LLM Workbench version.`,
    );
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
