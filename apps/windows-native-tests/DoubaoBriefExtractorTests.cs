namespace AIHub.Windows.Tests;

public sealed class DoubaoBriefExtractorTests
{
    [Fact]
    public void ExtractsBriefFromNestedResponse()
    {
        const string payload = """
            {
              "data": {
                "t": {
                  "agent_id": "19457456070409730",
                  "agent_name": "豆包",
                  "brief": "这是豆包真正的回复正文",
                  "chat_id": "46049449420731650"
                }
              }
            }
            """;

        Assert.Equal(
            "这是豆包真正的回复正文",
            Assert.Single(DoubaoBriefExtractor.Extract(payload)));
    }

    [Fact]
    public void ExtractsBriefFromServerSentEvent()
    {
        const string payload =
            "data: {\"t\":{\"agent_name\":\"豆包\",\"brief\":\"第一段回复\"}}\n\n";

        Assert.Contains("第一段回复", DoubaoBriefExtractor.Extract(payload));
    }

    [Fact]
    public void DoesNotReturnOtherResponseMetadata()
    {
        const string payload = """
            {
              "agent_name": "豆包",
              "chat_id": "123",
              "bot_state": "{\"bot_name\":\"豆包\"}"
            }
            """;

        Assert.Empty(DoubaoBriefExtractor.Extract(payload));
    }

    [Fact]
    public void RepairsUtf8TextDecodedAsWindows1252()
    {
        const string expected = "今天天气怎么样";
        var mojibake = System.Text.Encoding.Latin1.GetString(
            System.Text.Encoding.UTF8.GetBytes(expected));

        Assert.Equal(expected, TextEncodingRepair.Normalize(mojibake));
    }

    [Fact]
    public void WaitsForTheMostCompleteBriefCandidate()
    {
        const string payload = """
            data: {"t":{"brief":"你"}}
            data: {"t":{"brief":"你好呀，今天有什么我能帮你的吗？"}}
            """;

        var candidates = DoubaoBriefExtractor.Extract(payload);
        Assert.Contains("你", candidates);
        Assert.Contains("你好呀，今天有什么我能帮你的吗？", candidates);
    }

    [Fact]
    public void DiagnosticInspectorKeepsTextPathsButDropsSensitiveMetadata()
    {
        const string payload = """
            {
              "chat_id": "123",
              "token": "secret",
              "data": {
                "brief": "摘要",
                "content": "网页最终显示的完整回答"
              }
            }
            """;

        var candidates = DoubaoResponseInspector.ExtractCandidates(payload);
        Assert.Contains(candidates, item =>
            item.Path.EndsWith(".content") &&
            item.Text == "网页最终显示的完整回答");
        Assert.DoesNotContain(candidates, item =>
            item.Path.Contains("token") || item.Path.Contains("chat_id"));
    }

    [Fact]
    public void ExtractsAssistantTextChunksButNotUserContentBlocks()
    {
        const string payload = """
            data: {"message":{"content_block":[{"content":{"text_block":{"text":"你好豆包"}}}]}}
            data: {"patch_op":[{"patch_value":{"text":"你好呀😊有什么我可以"}}]}
            data: {"patch_op":[{"patch_value":{"text":"帮你的吗？"}}]}
            """;

        var chunks = DoubaoStreamExtractor.Extract(payload);
        Assert.Equal(
            ["你好呀😊有什么我可以", "帮你的吗？"],
            chunks.Select(item => item.Text));
    }
}
