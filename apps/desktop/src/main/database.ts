import { DatabaseSync } from "node:sqlite";
import type {
  ContentBlock,
  ComparisonSession,
  AppSettingsPayload,
  AdapterEventRecord,
  ConversationFolder,
  ConversationTag,
  NormalizedConversation,
  NormalizedMessage,
  KnowledgeDocument,
  ProviderId,
  ProviderFailureOrigin,
  ProviderSendPhase,
  ProviderState,
  SystemPrompt,
} from "@aihub/core";
import { messageToText } from "@aihub/core";

function normalizedMessageText(content: ContentBlock[]): string {
  return content
    .map((block) => {
      if (block.type === "text" || block.type === "code") return block.text;
      if (block.type === "image") return block.alt ?? block.src;
      if (block.type === "attachment") return block.name;
      if (block.type === "citation") return block.title ?? block.url;
      if (block.type === "math") return block.tex;
      return block.html;
    })
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

interface ConversationRow {
  id: string;
  title: string;
  provider: ProviderId;
  external_id: string | null;
  sync_status: NormalizedConversation["syncStatus"] | null;
  last_synced_at: string | null;
  sync_error: string | null;
  remote_missing_count: number;
  hidden: number;
  pinned: number;
  pinned_at: string | null;
  system_prompt_id: string | null;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: NormalizedMessage["role"];
  content_json: string;
  provider_html: string | null;
  status: NormalizedMessage["status"];
  status_phase: string | null;
  status_detail: string | null;
  error_code: string | null;
  failure_origin: string | null;
  provider: ProviderId;
  created_at: string;
  remote_key: string | null;
  source_order: number | null;
}

interface SystemPromptRow {
  id: string;
  name: string;
  content: string;
  provider: ProviderId | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface ComparisonSessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ComparisonParticipantRow {
  conversation_id: string;
  provider: ProviderId;
}

interface DocumentRow {
  id: string;
  name: string;
  file_path: string;
  content: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

interface AdapterEventRow {
  id: number;
  provider: ProviderId;
  type: string;
  detail: string | null;
  created_at: string;
}

export class AppDatabase {
  private readonly db: DatabaseSync;
  private closed = false;

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
        provider_html TEXT,
        status TEXT NOT NULL,
        status_phase TEXT,
        status_detail TEXT,
        error_code TEXT,
        failure_origin TEXT,
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
      CREATE TABLE IF NOT EXISTS system_prompts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        provider TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comparison_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comparison_participants (
        session_id TEXT NOT NULL REFERENCES comparison_sessions(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        PRIMARY KEY (session_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_documents (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        PRIMARY KEY (conversation_id, document_id)
      );
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_tags (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (conversation_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);
    `);
    this.addColumnIfMissing("messages", "provider_html", "TEXT");
    this.addColumnIfMissing("messages", "status_phase", "TEXT");
    this.addColumnIfMissing("messages", "status_detail", "TEXT");
    this.addColumnIfMissing("messages", "error_code", "TEXT");
    this.addColumnIfMissing("messages", "failure_origin", "TEXT");
    this.addColumnIfMissing("messages", "remote_key", "TEXT");
    this.addColumnIfMissing("messages", "source_order", "INTEGER");
    this.addColumnIfMissing(
      "conversations",
      "pinned",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.addColumnIfMissing("conversations", "pinned_at", "TEXT");
    this.addColumnIfMissing("conversations", "system_prompt_id", "TEXT");
    this.addColumnIfMissing("conversations", "folder_id", "TEXT");
    this.addColumnIfMissing(
      "conversations",
      "sync_status",
      "TEXT NOT NULL DEFAULT 'not-synced'",
    );
    this.addColumnIfMissing("conversations", "last_synced_at", "TEXT");
    this.addColumnIfMissing("conversations", "sync_error", "TEXT");
    this.addColumnIfMissing(
      "conversations",
      "remote_missing_count",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_remote_key
        ON messages(conversation_id, remote_key)
        WHERE remote_key IS NOT NULL;
    `);
    this.initializeFullTextSearch();
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
      pinned: false,
      systemPromptId: undefined,
      documentIds: [],
      folderId: undefined,
      tagIds: [],
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  getConversationByExternalId(
    provider: ProviderId,
    externalId: string,
  ): NormalizedConversation | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE provider = ? AND external_id = ? LIMIT 1")
      .get(provider, externalId) as ConversationRow | undefined;
    return row ? this.hydrateConversation(row) : undefined;
  }

  updateWebConversation(id: string, title: string, externalId: string): void {
    this.db.prepare(
      `UPDATE conversations
       SET title = ?, external_id = ?, remote_missing_count = 0,
           sync_status = CASE
             WHEN sync_status = 'remote-missing' THEN 'not-synced'
             ELSE sync_status
           END,
           sync_error = CASE
             WHEN sync_status = 'remote-missing' THEN NULL
             ELSE sync_error
           END
       WHERE id = ?
         AND (
           title <> ? OR external_id <> ? OR remote_missing_count <> 0
           OR sync_status = 'remote-missing'
         )`,
    ).run(title, externalId, id, title, externalId);
  }

  setConversationSyncState(
    id: string,
    status: NonNullable<NormalizedConversation["syncStatus"]>,
    options: { error?: string; syncedAt?: string } = {},
  ): void {
    this.db.prepare(
      `UPDATE conversations
       SET sync_status = ?, sync_error = ?, last_synced_at = COALESCE(?, last_synced_at)
       WHERE id = ?`,
    ).run(
      status,
      options.error ?? null,
      options.syncedAt ?? null,
      id,
    );
  }

  markMissingWebConversations(provider: ProviderId, seenExternalIds: Set<string>): void {
    const rows = this.db
      .prepare(
        `SELECT id, external_id, remote_missing_count
         FROM conversations
         WHERE provider = ? AND external_id IS NOT NULL`,
      )
      .all(provider) as unknown as Array<{
        id: string;
        external_id: string;
        remote_missing_count: number;
      }>;
    const statement = this.db.prepare(
      `UPDATE conversations
       SET remote_missing_count = ?,
           sync_status = CASE WHEN ? >= 2 THEN 'remote-missing' ELSE sync_status END,
           sync_error = CASE WHEN ? >= 2 THEN 'Conversation was not found on the provider website.' ELSE sync_error END
       WHERE id = ?`,
    );
    for (const row of rows) {
      if (seenExternalIds.has(row.external_id)) continue;
      const missingCount = row.remote_missing_count + 1;
      statement.run(missingCount, missingCount, missingCount, row.id);
    }
  }

  upsertWebsiteMessage(input: {
    id: string;
    conversationId: string;
    provider: ProviderId;
    remoteKey: string;
    sourceOrder: number;
    role: "user" | "assistant";
    content: ContentBlock[];
    providerHtml?: string;
    createdAt: string;
  }): void {
    const byRemoteKey = this.db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? AND remote_key = ? LIMIT 1",
      )
      .get(input.conversationId, input.remoteKey) as MessageRow | undefined;
    if (byRemoteKey) {
      const unchanged =
        byRemoteKey.content_json === JSON.stringify(input.content) &&
        byRemoteKey.provider_html === (input.providerHtml ?? null) &&
        byRemoteKey.status === "completed" &&
        byRemoteKey.source_order === input.sourceOrder;
      if (unchanged) return;
      this.updateMessage(
        byRemoteKey.id,
        input.content,
        "completed",
        input.providerHtml,
      );
      this.db.prepare(
        "UPDATE messages SET source_order = ? WHERE id = ?",
      ).run(input.sourceOrder, byRemoteKey.id);
      return;
    }

    const candidates = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ? AND role = ? AND remote_key IS NULL
           AND status = 'completed'
         ORDER BY created_at, rowid`,
      )
      .all(input.conversationId, input.role) as unknown as MessageRow[];
    const expectedText = normalizedMessageText(input.content);
    const matched = candidates.find(
      (candidate) =>
        normalizedMessageText(
          JSON.parse(candidate.content_json) as ContentBlock[],
        ) === expectedText,
    );
    if (matched) {
      this.updateMessage(
        matched.id,
        input.content,
        "completed",
        input.providerHtml,
      );
      this.db.prepare(
        "UPDATE messages SET remote_key = ?, source_order = ? WHERE id = ?",
      ).run(input.remoteKey, input.sourceOrder, matched.id);
      return;
    }

    this.addMessage({
      id: input.id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      providerHtml: input.providerHtml,
      status: "completed",
      provider: input.provider,
      createdAt: input.createdAt,
    });
    this.db.prepare(
      "UPDATE messages SET remote_key = ?, source_order = ? WHERE id = ?",
    ).run(input.remoteKey, input.sourceOrder, input.id);
  }

  addMessage(message: NormalizedMessage): void {
    this.db
      .prepare(
        `INSERT INTO messages
          (id, conversation_id, role, content_json, provider_html, status, status_phase, status_detail, error_code, failure_origin, provider, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        JSON.stringify(message.content),
        message.providerHtml ?? null,
        message.status,
        message.statusPhase ?? null,
        message.statusDetail ?? null,
        message.errorCode ?? null,
        message.failureOrigin ?? null,
        message.provider,
        message.createdAt,
      );
    this.upsertMessageSearch(message);
    this.touchConversation(message.conversationId);
  }

  upsertMessage(message: NormalizedMessage): void {
    if (this.getMessage(message.id)) {
      this.updateMessage(message.id, message.content, message.status, message.providerHtml, message);
      return;
    }
    this.addMessage(message);
  }

  updateMessage(
    messageId: string,
    content: ContentBlock[],
    status: NormalizedMessage["status"],
    providerHtml?: string,
    metadata?: Pick<
      NormalizedMessage,
      "statusPhase" | "statusDetail" | "errorCode" | "failureOrigin"
    >,
  ): void {
    this.db
      .prepare(
        `UPDATE messages
         SET content_json = ?, provider_html = ?, status = ?, status_phase = ?, status_detail = ?, error_code = ?, failure_origin = ?
         WHERE id = ?`,
      )
      .run(
        JSON.stringify(content),
        providerHtml ?? null,
        status,
        metadata?.statusPhase ?? null,
        metadata?.statusDetail ?? null,
        metadata?.errorCode ?? null,
        metadata?.failureOrigin ?? null,
        messageId,
      );
    const message = this.getMessage(messageId);
    if (message) {
      this.upsertMessageSearch(message);
      this.touchConversation(message.conversationId);
    }
  }

  getMessage(messageId: string): NormalizedMessage | undefined {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(messageId) as MessageRow | undefined;
    return row ? this.hydrateMessage(row) : undefined;
  }

  deleteMessage(conversationId: string, messageId: string): void {
    this.db
      .prepare("DELETE FROM messages_fts WHERE message_id = ?")
      .run(messageId);
    this.db
      .prepare("DELETE FROM messages WHERE id = ? AND conversation_id = ?")
      .run(messageId, conversationId);
    this.touchConversation(conversationId);
  }

  deleteMessagesFrom(conversationId: string, messageId: string): void {
    const row = this.db
      .prepare(
        "SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?",
      )
      .get(messageId, conversationId) as { rowid: number } | undefined;
    if (!row) return;

    this.db
      .prepare(
        `DELETE FROM messages_fts
         WHERE message_id IN (
           SELECT id FROM messages
           WHERE conversation_id = ? AND rowid >= ?
         )`,
      )
      .run(conversationId, row.rowid);
    this.db
      .prepare(
        "DELETE FROM messages WHERE conversation_id = ? AND rowid >= ?",
      )
      .run(conversationId, row.rowid);
    this.touchConversation(conversationId);
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
         ORDER BY pinned DESC, pinned_at DESC, updated_at DESC`,
      )
      .all() as unknown as ConversationRow[];
    return rows.map((row) => this.hydrateConversation(row));
  }

  searchConversations(query: string): NormalizedConversation[] {
    const normalized = query.trim();
    if (!normalized) return this.listConversations();

    const pattern = `%${normalized}%`;
    const ftsQuery = normalized
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" AND ");
    const rows = this.db
      .prepare(
        `SELECT DISTINCT conversations.*
         FROM conversations
         WHERE conversations.hidden = 0
           AND (
             conversations.title LIKE ? COLLATE NOCASE
             OR conversations.id IN (
               SELECT conversation_id FROM messages_fts
               WHERE messages_fts MATCH ?
             )
           )
         ORDER BY conversations.pinned DESC,
           conversations.pinned_at DESC,
           conversations.updated_at DESC`,
      )
      .all(pattern, ftsQuery) as unknown as ConversationRow[];
    return rows.map((row) => this.hydrateConversation(row));
  }

  setConversationPinned(conversationId: string, pinned: boolean): void {
    this.db
      .prepare(
        `UPDATE conversations
         SET pinned = ?, pinned_at = ?
         WHERE id = ?`,
      )
      .run(
        Number(pinned),
        pinned ? new Date().toISOString() : null,
        conversationId,
      );
  }

  renameConversation(conversationId: string, title: string): void {
    this.db
      .prepare(
        `UPDATE conversations
         SET title = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(title, new Date().toISOString(), conversationId);
  }

  deleteConversation(conversationId: string): void {
    this.db
      .prepare("DELETE FROM messages_fts WHERE conversation_id = ?")
      .run(conversationId);
    this.db
      .prepare("DELETE FROM conversations WHERE id = ?")
      .run(conversationId);
  }

  listSystemPrompts(): SystemPrompt[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM system_prompts
         ORDER BY is_default DESC, updated_at DESC`,
      )
      .all() as unknown as SystemPromptRow[];
    return rows.map((row) => this.hydrateSystemPrompt(row));
  }

  getSystemPrompt(id: string): SystemPrompt | undefined {
    const row = this.db
      .prepare("SELECT * FROM system_prompts WHERE id = ?")
      .get(id) as SystemPromptRow | undefined;
    return row ? this.hydrateSystemPrompt(row) : undefined;
  }

  getDefaultSystemPrompt(provider: ProviderId): SystemPrompt | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM system_prompts
         WHERE is_default = 1 AND (provider = ? OR provider IS NULL)
         ORDER BY CASE WHEN provider = ? THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`,
      )
      .get(provider, provider) as SystemPromptRow | undefined;
    return row ? this.hydrateSystemPrompt(row) : undefined;
  }

  createSystemPrompt(prompt: SystemPrompt): void {
    this.db.exec("BEGIN");
    try {
      if (prompt.isDefault) this.clearDefaultPrompt(prompt.provider);
      this.db
        .prepare(
          `INSERT INTO system_prompts
           (id, name, content, provider, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          prompt.id,
          prompt.name,
          prompt.content,
          prompt.provider ?? null,
          Number(prompt.isDefault),
          prompt.createdAt,
          prompt.updatedAt,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateSystemPrompt(prompt: SystemPrompt): void {
    this.db.exec("BEGIN");
    try {
      if (prompt.isDefault) this.clearDefaultPrompt(prompt.provider);
      this.db
        .prepare(
          `UPDATE system_prompts
           SET name = ?, content = ?, provider = ?, is_default = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          prompt.name,
          prompt.content,
          prompt.provider ?? null,
          Number(prompt.isDefault),
          prompt.updatedAt,
          prompt.id,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  deleteSystemPrompt(id: string): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "UPDATE conversations SET system_prompt_id = NULL WHERE system_prompt_id = ?",
        )
        .run(id);
      this.db.prepare("DELETE FROM system_prompts WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setConversationSystemPrompt(
    conversationId: string,
    systemPromptId?: string,
  ): void {
    this.db
      .prepare(
        "UPDATE conversations SET system_prompt_id = ? WHERE id = ?",
      )
      .run(systemPromptId ?? null, conversationId);
  }

  createComparisonSession(session: ComparisonSession): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO comparison_sessions
           (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.title,
          session.createdAt,
          session.updatedAt,
        );
      const insertParticipant = this.db.prepare(
        `INSERT INTO comparison_participants
         (session_id, conversation_id, provider) VALUES (?, ?, ?)`,
      );
      for (const participant of session.participants) {
        insertParticipant.run(
          session.id,
          participant.conversationId,
          participant.provider,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getComparisonSession(id: string): ComparisonSession | undefined {
    const row = this.db
      .prepare("SELECT * FROM comparison_sessions WHERE id = ?")
      .get(id) as ComparisonSessionRow | undefined;
    return row ? this.hydrateComparison(row) : undefined;
  }

  listComparisonSessions(): ComparisonSession[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM comparison_sessions ORDER BY updated_at DESC",
      )
      .all() as unknown as ComparisonSessionRow[];
    return rows.map((row) => this.hydrateComparison(row));
  }

  touchComparisonSession(id: string): void {
    this.db
      .prepare("UPDATE comparison_sessions SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  addDocument(document: KnowledgeDocument): void {
    this.db
      .prepare(
        `INSERT INTO documents
         (id, name, file_path, content, mime_type, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        document.id,
        document.name,
        document.filePath,
        document.content,
        document.mimeType,
        document.sizeBytes,
        document.createdAt,
        document.updatedAt,
      );
  }

  listDocuments(): KnowledgeDocument[] {
    const rows = this.db
      .prepare("SELECT * FROM documents ORDER BY updated_at DESC")
      .all() as unknown as DocumentRow[];
    return rows.map((row) => this.hydrateDocument(row));
  }

  removeDocument(id: string): void {
    this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  }

  setConversationDocuments(
    conversationId: string,
    documentIds: string[],
  ): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "DELETE FROM conversation_documents WHERE conversation_id = ?",
        )
        .run(conversationId);
      const insert = this.db.prepare(
        `INSERT INTO conversation_documents
         (conversation_id, document_id) VALUES (?, ?)`,
      );
      for (const documentId of documentIds) {
        insert.run(conversationId, documentId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getConversationDocuments(
    conversationId: string,
  ): KnowledgeDocument[] {
    const rows = this.db
      .prepare(
        `SELECT documents.*
         FROM documents
         INNER JOIN conversation_documents
           ON conversation_documents.document_id = documents.id
         WHERE conversation_documents.conversation_id = ?
         ORDER BY documents.updated_at DESC`,
      )
      .all(conversationId) as unknown as DocumentRow[];
    return rows.map((row) => this.hydrateDocument(row));
  }

  createFolder(folder: ConversationFolder): void {
    this.db
      .prepare(
        `INSERT INTO folders (id, name, parent_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        folder.id,
        folder.name,
        folder.parentId ?? null,
        folder.createdAt,
      );
  }

  listFolders(): ConversationFolder[] {
    return (
      this.db
        .prepare("SELECT * FROM folders ORDER BY name COLLATE NOCASE")
        .all() as unknown as FolderRow[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id ?? undefined,
      createdAt: row.created_at,
    }));
  }

  renameFolder(id: string, name: string): void {
    this.db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, id);
  }

  deleteFolder(id: string): void {
    this.db
      .prepare("UPDATE conversations SET folder_id = NULL WHERE folder_id = ?")
      .run(id);
    this.db.prepare("DELETE FROM folders WHERE id = ?").run(id);
  }

  createTag(tag: ConversationTag): void {
    this.db
      .prepare(
        `INSERT INTO tags (id, name, color, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(tag.id, tag.name, tag.color, tag.createdAt);
  }

  listTags(): ConversationTag[] {
    return (
      this.db
        .prepare("SELECT * FROM tags ORDER BY name COLLATE NOCASE")
        .all() as unknown as TagRow[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at,
    }));
  }

  deleteTag(id: string): void {
    this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  }

  setConversationFolder(
    conversationId: string,
    folderId?: string,
  ): void {
    this.db
      .prepare("UPDATE conversations SET folder_id = ? WHERE id = ?")
      .run(folderId ?? null, conversationId);
  }

  setConversationTags(conversationId: string, tagIds: string[]): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("DELETE FROM conversation_tags WHERE conversation_id = ?")
        .run(conversationId);
      const insert = this.db.prepare(
        `INSERT INTO conversation_tags
         (conversation_id, tag_id) VALUES (?, ?)`,
      );
      for (const tagId of tagIds) insert.run(conversationId, tagId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSettings(): AppSettingsPayload {
    const row = this.db
      .prepare("SELECT value_json FROM app_settings WHERE key = 'renderer'")
      .get() as { value_json: string } | undefined;
    return row
      ? (JSON.parse(row.value_json) as AppSettingsPayload)
      : {};
  }

  setSettings(settings: AppSettingsPayload): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at)
         VALUES ('renderer', ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(settings), new Date().toISOString());
  }

  getStorageMetrics(): {
    conversationCount: number;
    messageCount: number;
    documentCount: number;
    documentBytes: number;
    indexedCharacterCount: number;
  } {
    const scalar = (sql: string): number => {
      const row = this.db.prepare(sql).get() as { value: number | null };
      return Number(row.value ?? 0);
    };
    return {
      conversationCount: scalar(
        "SELECT COUNT(*) AS value FROM conversations WHERE hidden = 0",
      ),
      messageCount: scalar("SELECT COUNT(*) AS value FROM messages"),
      documentCount: scalar("SELECT COUNT(*) AS value FROM documents"),
      documentBytes: scalar(
        "SELECT COALESCE(SUM(size_bytes), 0) AS value FROM documents",
      ),
      indexedCharacterCount: scalar(
        "SELECT COALESCE(SUM(LENGTH(content)), 0) AS value FROM documents",
      ),
    };
  }

  updateExternalId(conversationId: string, externalId?: string): void {
    this.db
      .prepare("UPDATE conversations SET external_id = ? WHERE id = ?")
      .run(externalId ?? null, conversationId);
  }

  createTransfer(input: {
    id: string;
    sourceConversationId: string;
    targetProvider: ProviderId;
    markdown: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO transfers
          (id, source_conversation_id, target_provider, markdown, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?)`,
      )
      .run(
        input.id,
        input.sourceConversationId,
        input.targetProvider,
        input.markdown,
        now,
        now,
      );
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

  listAdapterEvents(
    provider?: ProviderId,
    limit = 50,
    sinceCreatedAt?: string,
  ): AdapterEventRecord[] {
    const boundedLimit = Math.max(1, Math.min(500, limit));
    const statement = provider && sinceCreatedAt
      ? this.db.prepare(
        `SELECT id, provider, type, detail, created_at
          FROM adapter_events
          WHERE provider = ? AND created_at >= ?
          ORDER BY id DESC
          LIMIT ?`,
      )
      : provider
        ? this.db.prepare(
          `SELECT id, provider, type, detail, created_at
            FROM adapter_events
            WHERE provider = ?
            ORDER BY id DESC
            LIMIT ?`,
        )
        : sinceCreatedAt
          ? this.db.prepare(
            `SELECT id, provider, type, detail, created_at
              FROM adapter_events
              WHERE created_at >= ?
              ORDER BY id DESC
              LIMIT ?`,
          )
          : this.db.prepare(
            `SELECT id, provider, type, detail, created_at
              FROM adapter_events
              ORDER BY id DESC
              LIMIT ?`,
          );
    const rows = provider && sinceCreatedAt
      ? statement.all(provider, sinceCreatedAt, boundedLimit)
      : provider
        ? statement.all(provider, boundedLimit)
        : sinceCreatedAt
          ? statement.all(sinceCreatedAt, boundedLimit)
          : statement.all(boundedLimit);
    return rows
      .map((row) => {
        const event = row as unknown as AdapterEventRow;
        return {
          id: event.id,
          provider: event.provider,
          type: event.type,
          detail: event.detail ?? undefined,
          createdAt: event.created_at,
        };
      });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  isClosed(): boolean {
    return this.closed;
  }

  private touchConversation(id: string): void {
    this.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  private hydrateConversation(row: ConversationRow): NormalizedConversation {
    const messages = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY
           CASE WHEN source_order IS NULL THEN 1 ELSE 0 END,
           source_order,
           created_at,
           rowid`,
      )
      .all(row.id) as unknown as MessageRow[];
    return {
      id: row.id,
      title: row.title,
      provider: row.provider,
      externalId: row.external_id ?? undefined,
      syncStatus: row.sync_status ?? undefined,
      lastSyncedAt: row.last_synced_at ?? undefined,
      syncError: row.sync_error ?? undefined,
      remoteMissingCount: row.remote_missing_count,
      hidden: Boolean(row.hidden),
      pinned: Boolean(row.pinned),
      pinnedAt: row.pinned_at ?? undefined,
      systemPromptId: row.system_prompt_id ?? undefined,
      documentIds: this.db
        .prepare(
          `SELECT document_id FROM conversation_documents
           WHERE conversation_id = ?`,
        )
        .all(row.id)
        .map((item) => (item as { document_id: string }).document_id),
      folderId: row.folder_id ?? undefined,
      tagIds: this.db
        .prepare(
          `SELECT tag_id FROM conversation_tags
           WHERE conversation_id = ?`,
        )
        .all(row.id)
        .map((item) => (item as { tag_id: string }).tag_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: messages.map((message) => this.hydrateMessage(message)),
    };
  }

  private hydrateMessage(row: MessageRow): NormalizedMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: JSON.parse(row.content_json) as ContentBlock[],
      providerHtml: row.provider_html ?? undefined,
      status: row.status,
      statusPhase: (row.status_phase as ProviderSendPhase | null) ?? undefined,
      statusDetail: row.status_detail ?? undefined,
      errorCode: row.error_code ?? undefined,
      failureOrigin:
        (row.failure_origin as ProviderFailureOrigin | null) ?? undefined,
      provider: row.provider,
      createdAt: row.created_at,
    };
  }

  private addColumnIfMissing(
    table: string,
    column: string,
    definition: string,
  ): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as unknown as { name: string }[];
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private clearDefaultPrompt(provider?: ProviderId): void {
    if (provider) {
      this.db
        .prepare(
          "UPDATE system_prompts SET is_default = 0 WHERE provider = ?",
        )
        .run(provider);
    } else {
      this.db
        .prepare(
          "UPDATE system_prompts SET is_default = 0 WHERE provider IS NULL",
        )
        .run();
    }
  }

  private hydrateSystemPrompt(row: SystemPromptRow): SystemPrompt {
    return {
      id: row.id,
      name: row.name,
      content: row.content,
      provider: row.provider ?? undefined,
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateComparison(
    row: ComparisonSessionRow,
  ): ComparisonSession {
    const participants = this.db
      .prepare(
        `SELECT conversation_id, provider
         FROM comparison_participants WHERE session_id = ?`,
      )
      .all(row.id) as unknown as ComparisonParticipantRow[];
    return {
      id: row.id,
      title: row.title,
      participants: participants.map((participant) => ({
        conversationId: participant.conversation_id,
        provider: participant.provider,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateDocument(row: DocumentRow): KnowledgeDocument {
    return {
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      content: row.content,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private initializeFullTextSearch(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        message_id UNINDEXED,
        conversation_id UNINDEXED,
        content,
        tokenize = 'unicode61'
      );
    `);
    const messages = this.db
      .prepare(
        `SELECT messages.* FROM messages
         LEFT JOIN messages_fts ON messages_fts.message_id = messages.id
         WHERE messages_fts.message_id IS NULL`,
      )
      .all() as unknown as MessageRow[];
    for (const message of messages) {
      this.upsertMessageSearch(this.hydrateMessage(message));
    }
  }

  private upsertMessageSearch(message: NormalizedMessage): void {
    const content = messageToText(message);
    this.db
      .prepare("DELETE FROM messages_fts WHERE message_id = ?")
      .run(message.id);
    this.db
      .prepare(
        `INSERT INTO messages_fts
         (message_id, conversation_id, content) VALUES (?, ?, ?)`,
      )
      .run(message.id, message.conversationId, content);
  }
}
