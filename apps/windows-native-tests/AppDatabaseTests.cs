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
                "attachment", "message", "report.pdf", AttachmentKind.Pdf,
                2048, "pending"));
            database.UpdateAttachment("attachment", "uploaded");

            var restored = Assert.Single(database.GetConversations());
            Assert.True(restored.IsPinned);
            Assert.Equal("未发送草稿", restored.Draft);
            Assert.Equal(
                "uploaded",
                Assert.Single(database.GetAttachments("message")).Status);
        }
        finally
        {
            File.Delete(path);
            File.Delete(path + "-wal");
            File.Delete(path + "-shm");
        }
    }
}
