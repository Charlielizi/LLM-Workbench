import { DatabaseSync } from "node:sqlite";
import type {
  ContentBlock,
  NormalizedConversation,
  NormalizedMessage,
  ProviderId,
  ProviderState,
} from "@aihub/core";

interface ConversationRow {
  id: string;
  title: string;
  provider: ProviderId;
  external_id: string | null;
  hidden: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: NormalizedMessage["role"];
  content_json: string;
  status: NormalizedMessage["status"];
  provider: ProviderId;
  created_at: string;
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        authenticated INTEGER NOT NULL DEFAULT 0,
        ready INTEGER NOT NULL DEFAULT 0,
        degraded INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        adapter_version TEXT NOT NULL DEFAULT '0.1.0',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content_json TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_fragments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        source_conversation_id TEXT NOT NULL,
        target_conversation_id TEXT,
        target_provider TEXT NOT NULL,
        markdown TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS adapter_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);
    `);
  }

  upsertProvider(provider: ProviderId, state: ProviderState): void {
    this.db
      .prepare(
        `INSERT INTO providers
          (id, authenticated, ready, degraded, reason, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          authenticated = excluded.authenticated,
          ready = excluded.ready,
          degraded = excluded.degraded,
          reason = excluded.reason,
          updated_at = excluded.updated_at`,
      )
      .run(
        provider,
        Number(state.authenticated),
        Number(state.ready),
        Number(state.degraded),
        state.reason ?? null,
        new Date().toISOString(),
      );
  }

  createConversation(input: {
    id: string;
    title: string;
    provider: ProviderId;
    externalId?: string;
    hidden?: boolean;
  }): NormalizedConversation {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO conversations
          (id, title, provider, external_id, hidden, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.title,
        input.provider,
        input.externalId ?? null,
        Number(input.hidden ?? false),
        now,
        now,
      );
    return {
      id: input.id,
      title: input.title,
      provider: input.provider,
      externalId: input.externalId,
      hidden: input.hidden ?? false,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  addMessage(message: NormalizedMessage): void {
    this.db
      .prepare(
        `INSERT INTO messages
          (id, conversation_id, role, content_json, status, provider, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        JSON.stringify(message.content),
        message.status,
        message.provider,
        message.createdAt,
      );
    this.touchConversation(message.conversationId);
  }

  updateMessage(
    messageId: string,
    content: ContentBlock[],
    status: NormalizedMessage["status"],
  ): void {
    this.db
      .prepare("UPDATE messages SET content_json = ?, status = ? WHERE id = ?")
      .run(JSON.stringify(content), status, messageId);
  }

  addFragment(messageId: string, sequence: number, text: string): void {
    this.db
      .prepare(
        `INSERT INTO message_fragments
          (message_id, sequence, text, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(messageId, sequence, text, new Date().toISOString());
  }

  getConversation(id: string): NormalizedConversation | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;
    return row ? this.hydrateConversation(row) : undefined;
  }

  listConversations(includeHidden = false): NormalizedConversation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations
         ${includeHidden ? "" : "WHERE hidden = 0"}
         ORDER BY updated_at DESC`,
      )
      .all() as unknown as ConversationRow[];
    return rows.map((row) => this.hydrateConversation(row));
  }

  updateExternalId(conversationId: string, externalId?: string): void {
    this.db
      .prepare("UPDATE conversations SET external_id = ? WHERE id = ?")
      .run(externalId ?? null, conversationId);
  }

  createTransfer(input: {
    id: string;
    sourceConversationId: string;
    markdown: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO transfers
          (id, source_conversation_id, target_provider, markdown, status, created_at, updated_at)
         VALUES (?, ?, 'claude', ?, 'running', ?, ?)`,
      )
      .run(input.id, input.sourceConversationId, input.markdown, now, now);
  }

  finishTransfer(
    id: string,
    targetConversationId: string | undefined,
    error?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE transfers SET target_conversation_id = ?, status = ?,
          error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        targetConversationId ?? null,
        error ? "failed" : "completed",
        error ?? null,
        new Date().toISOString(),
        id,
      );
  }

  logAdapterEvent(provider: ProviderId, type: string, detail?: string): void {
    const safeDetail = detail
      ?.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
      .replace(/[A-Za-z0-9_-]{40,}/g, "[secret]");
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO adapter_events
            (provider, type, detail, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(
          provider,
          type,
          safeDetail?.slice(0, 1_000) ?? null,
          new Date().toISOString(),
        );
      this.db.exec(`
        DELETE FROM adapter_events WHERE id NOT IN (
          SELECT id FROM adapter_events ORDER BY id DESC LIMIT 500
        )
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private touchConversation(id: string): void {
    this.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  private hydrateConversation(row: ConversationRow): NormalizedConversation {
    const messages = this.db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
      )
      .all(row.id) as unknown as MessageRow[];
    return {
      id: row.id,
      title: row.title,
      provider: row.provider,
      externalId: row.external_id ?? undefined,
      hidden: Boolean(row.hidden),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: messages.map((message) => ({
        id: message.id,
        conversationId: message.conversation_id,
        role: message.role,
        content: JSON.parse(message.content_json) as ContentBlock[],
        status: message.status,
        provider: message.provider,
        createdAt: message.created_at,
      })),
    };
  }
}
