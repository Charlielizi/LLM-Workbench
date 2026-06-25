namespace AIHub.Windows.Tests;

public sealed class AppDatabaseTests
{
    [Fact]
    public void PersistsConversationAndMessages()
    {
        var path = Path.Combine(Path.GetTempPath(), $"aihub-{Guid.NewGuid():N}.sqlite");
        try
        {
            using (var database = new AppDatabase(path))
            {
                var conversation = database.CreateConversation(ProviderId.Doubao);
                database.AddMessage(new(
                    "message",
                    conversation.Id,
                    ProviderId.Doubao,
                    "user",
                    "你好",
                    "pending",
                    DateTimeOffset.UtcNow));
                database.UpdateMessage("message", "你好", "completed");

                Assert.Single(database.GetConversations());
                Assert.Equal(
                    "completed",
                    Assert.Single(database.GetMessages(conversation.Id)).Status);
            }
        }
        finally
        {
            File.Delete(path);
            File.Delete(path + "-wal");
            File.Delete(path + "-shm");
        }
    }

    [Fact]
    public void PersistsConversationWorkspaceStateAndAttachmentMetadata()
    {
        var path = Path.Combine(Path.GetTempPath(), $"aihub-{Guid.NewGuid():N}.sqlite");
        try
        {
            using var database = new AppDatabase(path);
            var conversation = database.CreateConversation(ProviderId.Doubao);
            database.UpdateConversation(
                conversation.Id, title: "置顶会话", pinned: true, draft: "未发送草稿");
            database.AddMessage(new MessageRecord(
                "message", conversation.Id, ProviderId.Doubao, "user",
                "请读取附件", "completed", DateTimeOffset.UtcNow));
            database.AddAttachment(new AttachmentRecord(
                "attachment", "message", @"C:\docs\report.pdf",
                "report.pdf", AttachmentKind.Pdf,
                2048, "pending"));
            database.UpdateAttachment("attachment", "uploaded");

            var restored = Assert.Single(database.GetConversations());
            Assert.True(restored.IsPinned);
            Assert.Equal("未发送草稿", restored.Draft);
            Assert.Equal(
                "uploaded",
                Assert.Single(database.GetAttachments("message")).Status);
            Assert.Equal(
                @"C:\docs\report.pdf",
                Assert.Single(database.GetAttachments("message")).LocalPath);
        }
        finally
        {
            File.Delete(path);
            File.Delete(path + "-wal");
            File.Delete(path + "-shm");
        }
    }

    [Fact]
    public void PersistsProviderHtmlForAssistantMessages()
    {
        var path = Path.Combine(Path.GetTempPath(), $"aihub-{Guid.NewGuid():N}.sqlite");
        try
        {
            using var database = new AppDatabase(path);
            var conversation = database.CreateConversation(ProviderId.Doubao);
            database.AddMessage(new MessageRecord(
                "assistant", conversation.Id, ProviderId.Doubao, "assistant",
                "答案", "streaming", DateTimeOffset.UtcNow));

            database.UpdateMessage(
                "assistant",
                "答案",
                "completed",
                html: "<p><strong>答案</strong></p>");

            Assert.Equal(
                "<p><strong>答案</strong></p>",
                Assert.Single(database.GetMessages(conversation.Id)).Html);
        }
        finally
        {
            File.Delete(path);
            File.Delete(path + "-wal");
            File.Delete(path + "-shm");
        }
    }

    [Fact]
    public void PersistsSendConfigurationSnapshot()
    {
        var path = Path.Combine(Path.GetTempPath(), $"aihub-{Guid.NewGuid():N}.sqlite");
        try
        {
            using var database = new AppDatabase(path);
            var conversation = database.CreateConversation(ProviderId.Doubao);
            database.AddMessage(new MessageRecord(
                "configured",
                conversation.Id,
                ProviderId.Doubao,
                "user",
                "请分析附件",
                "completed",
                DateTimeOffset.UtcNow,
                ModeSnapshot: """["Reasoning","WebSearch"]""",
                ModelSnapshot: "model-x"));

            var restored = Assert.Single(database.GetMessages(conversation.Id));
            Assert.Equal(
                """["Reasoning","WebSearch"]""",
                restored.ModeSnapshot);
            Assert.Equal("model-x", restored.ModelSnapshot);
        }
        finally
        {
            File.Delete(path);
            File.Delete(path + "-wal");
            File.Delete(path + "-shm");
        }
    }
}
