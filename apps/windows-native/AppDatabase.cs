using Microsoft.Data.Sqlite;

namespace AIHub.Windows;

public sealed class AppDatabase : IDisposable
{
    private readonly SqliteConnection _connection;

    public AppDatabase(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        _connection = new SqliteConnection($"Data Source={path};Pooling=False");
        _connection.Open();
        using var command = _connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              provider TEXT NOT NULL,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              is_pinned INTEGER NOT NULL DEFAULT 0,
              is_archived INTEGER NOT NULL DEFAULT 0,
              draft TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              provider TEXT NOT NULL,
              role TEXT NOT NULL,
              text TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              parent_message_id TEXT,
              stop_reason TEXT,
              error_code TEXT,
              mode_snapshot TEXT
            );
            CREATE TABLE IF NOT EXISTS attachments (
              id TEXT PRIMARY KEY,
              message_id TEXT NOT NULL,
              name TEXT NOT NULL,
              kind TEXT NOT NULL,
              size INTEGER NOT NULL,
              status TEXT NOT NULL,
              error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conversation
              ON messages(conversation_id, created_at);
            """;
        command.ExecuteNonQuery();
        EnsureColumn("conversations", "is_pinned", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("conversations", "is_archived", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn("conversations", "draft", "TEXT NOT NULL DEFAULT ''");
        EnsureColumn("messages", "parent_message_id", "TEXT");
        EnsureColumn("messages", "stop_reason", "TEXT");
        EnsureColumn("messages", "error_code", "TEXT");
        EnsureColumn("messages", "mode_snapshot", "TEXT");
    }

    public ConversationRecord CreateConversation(ProviderId provider)
    {
        var now = DateTimeOffset.UtcNow;
        var definition = ProviderCatalog.Get(provider);
        var record = new ConversationRecord(
            Guid.NewGuid().ToString("N"),
            provider,
            $"New {definition.Label} conversation",
            now,
            now);
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO conversations(id, provider, title, created_at, updated_at, is_pinned, is_archived, draft)
            VALUES($id, $provider, $title, $created, $updated, 0, 0, '')
            """;
        command.Parameters.AddWithValue("$id", record.Id);
        command.Parameters.AddWithValue("$provider", provider.ToString());
        command.Parameters.AddWithValue("$title", record.Title);
        command.Parameters.AddWithValue("$created", now.ToString("O"));
        command.Parameters.AddWithValue("$updated", now.ToString("O"));
        command.ExecuteNonQuery();
        return record;
    }

    public void AddMessage(MessageRecord message)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO messages(id, conversation_id, provider, role, text, status, created_at,
              parent_message_id, stop_reason, error_code, mode_snapshot)
            VALUES($id, $conversation, $provider, $role, $text, $status, $created,
              $parent, $stop, $error, $mode);
            UPDATE conversations SET updated_at=$created WHERE id=$conversation;
            """;
        command.Parameters.AddWithValue("$id", message.Id);
        command.Parameters.AddWithValue("$conversation", message.ConversationId);
        command.Parameters.AddWithValue("$provider", message.Provider.ToString());
        command.Parameters.AddWithValue("$role", message.Role);
        command.Parameters.AddWithValue("$text", message.Text);
        command.Parameters.AddWithValue("$status", message.Status);
        command.Parameters.AddWithValue("$created", message.CreatedAt.ToString("O"));
        command.Parameters.AddWithValue("$parent", (object?)message.ParentMessageId ?? DBNull.Value);
        command.Parameters.AddWithValue("$stop", (object?)message.StopReason ?? DBNull.Value);
        command.Parameters.AddWithValue("$error", (object?)message.ErrorCode ?? DBNull.Value);
        command.Parameters.AddWithValue("$mode", (object?)message.ModeSnapshot ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    public void UpdateMessage(
        string id,
        string text,
        string status,
        string? errorCode = null)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            UPDATE messages
            SET text=$text, status=$status, error_code=$error
            WHERE id=$id
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$text", text);
        command.Parameters.AddWithValue("$status", status);
        command.Parameters.AddWithValue("$error", (object?)errorCode ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    public void AddAttachment(AttachmentRecord attachment)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO attachments(id, message_id, name, kind, size, status, error)
            VALUES($id, $message, $name, $kind, $size, $status, $error)
            """;
        command.Parameters.AddWithValue("$id", attachment.Id);
        command.Parameters.AddWithValue("$message", attachment.MessageId);
        command.Parameters.AddWithValue("$name", attachment.Name);
        command.Parameters.AddWithValue("$kind", attachment.Kind.ToString());
        command.Parameters.AddWithValue("$size", attachment.Size);
        command.Parameters.AddWithValue("$status", attachment.Status);
        command.Parameters.AddWithValue("$error", (object?)attachment.Error ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    public void UpdateAttachment(string id, string status, string? error = null)
    {
        using var command = _connection.CreateCommand();
        command.CommandText =
            "UPDATE attachments SET status=$status, error=$error WHERE id=$id";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$status", status);
        command.Parameters.AddWithValue("$error", (object?)error ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    public IReadOnlyList<AttachmentRecord> GetAttachments(string messageId)
    {
        using var command = _connection.CreateCommand();
        command.CommandText =
            "SELECT * FROM attachments WHERE message_id=$message ORDER BY rowid";
        command.Parameters.AddWithValue("$message", messageId);
        using var reader = command.ExecuteReader();
        var result = new List<AttachmentRecord>();
        while (reader.Read())
        {
            result.Add(new AttachmentRecord(
                reader.GetString(reader.GetOrdinal("id")),
                reader.GetString(reader.GetOrdinal("message_id")),
                reader.GetString(reader.GetOrdinal("name")),
                Enum.Parse<AttachmentKind>(reader.GetString(reader.GetOrdinal("kind"))),
                reader.GetInt64(reader.GetOrdinal("size")),
                reader.GetString(reader.GetOrdinal("status")),
                reader.IsDBNull(reader.GetOrdinal("error"))
                    ? null
                    : reader.GetString(reader.GetOrdinal("error"))));
        }
        return result;
    }

    public void UpdateConversation(string id, string? title = null, bool? pinned = null,
        bool? archived = null, string? draft = null)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            UPDATE conversations SET
              title=COALESCE($title,title),
              is_pinned=COALESCE($pinned,is_pinned),
              is_archived=COALESCE($archived,is_archived),
              draft=COALESCE($draft,draft),
              updated_at=$updated
            WHERE id=$id
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$title", (object?)title ?? DBNull.Value);
        command.Parameters.AddWithValue("$pinned", pinned.HasValue ? Convert.ToInt32(pinned.Value) : DBNull.Value);
        command.Parameters.AddWithValue("$archived", archived.HasValue ? Convert.ToInt32(archived.Value) : DBNull.Value);
        command.Parameters.AddWithValue("$draft", (object?)draft ?? DBNull.Value);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
    }

    public void DeleteConversation(string id)
    {
        using var transaction = _connection.BeginTransaction();
        foreach (var sql in new[]
        {
            "DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=$id)",
            "DELETE FROM messages WHERE conversation_id=$id",
            "DELETE FROM conversations WHERE id=$id"
        })
        {
            using var command = _connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = sql;
            command.Parameters.AddWithValue("$id", id);
            command.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    public IReadOnlyList<ConversationRecord> GetConversations()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT * FROM conversations WHERE is_archived=0 ORDER BY is_pinned DESC, updated_at DESC";
        using var reader = command.ExecuteReader();
        var result = new List<ConversationRecord>();
        while (reader.Read())
        {
            result.Add(new(
                reader.GetString(reader.GetOrdinal("id")),
                Enum.Parse<ProviderId>(reader.GetString(reader.GetOrdinal("provider"))),
                reader.GetString(reader.GetOrdinal("title")),
                DateTimeOffset.Parse(reader.GetString(reader.GetOrdinal("created_at"))),
                DateTimeOffset.Parse(reader.GetString(reader.GetOrdinal("updated_at"))),
                reader.GetInt32(reader.GetOrdinal("is_pinned")) != 0,
                reader.GetInt32(reader.GetOrdinal("is_archived")) != 0,
                reader.GetString(reader.GetOrdinal("draft"))));
        }
        return result;
    }

    public IReadOnlyList<MessageRecord> GetMessages(string conversationId)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            SELECT * FROM messages WHERE conversation_id=$conversation
            ORDER BY created_at, rowid
            """;
        command.Parameters.AddWithValue("$conversation", conversationId);
        using var reader = command.ExecuteReader();
        var result = new List<MessageRecord>();
        while (reader.Read())
        {
            result.Add(new(
                reader.GetString(reader.GetOrdinal("id")),
                reader.GetString(reader.GetOrdinal("conversation_id")),
                Enum.Parse<ProviderId>(reader.GetString(reader.GetOrdinal("provider"))),
                reader.GetString(reader.GetOrdinal("role")),
                reader.GetString(reader.GetOrdinal("text")),
                reader.GetString(reader.GetOrdinal("status")),
                DateTimeOffset.Parse(reader.GetString(reader.GetOrdinal("created_at"))),
                reader.IsDBNull(reader.GetOrdinal("parent_message_id")) ? null : reader.GetString(reader.GetOrdinal("parent_message_id")),
                reader.IsDBNull(reader.GetOrdinal("stop_reason")) ? null : reader.GetString(reader.GetOrdinal("stop_reason")),
                reader.IsDBNull(reader.GetOrdinal("error_code")) ? null : reader.GetString(reader.GetOrdinal("error_code")),
                reader.IsDBNull(reader.GetOrdinal("mode_snapshot")) ? null : reader.GetString(reader.GetOrdinal("mode_snapshot"))));
        }
        return result;
    }

    public void Dispose() => _connection.Dispose();

    private void EnsureColumn(string table, string column, string definition)
    {
        using var check = _connection.CreateCommand();
        check.CommandText = $"PRAGMA table_info({table})";
        using var reader = check.ExecuteReader();
        while (reader.Read())
            if (reader.GetString(1).Equals(column, StringComparison.OrdinalIgnoreCase))
                return;
        reader.Close();
        using var alter = _connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE {table} ADD COLUMN {column} {definition}";
        alter.ExecuteNonQuery();
    }
}
