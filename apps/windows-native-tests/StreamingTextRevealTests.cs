namespace AIHub.Windows.Tests;

public sealed class StreamingTextRevealTests
{
    [Fact]
    public void WaitsForAShortUnfinishedFragment()
    {
        Assert.Null(StreamingTextReveal.NextChunk("", "正在思考这个问题", false));
    }

    [Fact]
    public void RevealsAtNaturalSentenceBoundaries()
    {
        const string text = "这是第一句。这里是仍在生成的第二句";
        Assert.Equal("这是第一句。", StreamingTextReveal.NextChunk("", text, false));
    }

    [Fact]
    public void RevealsShortFragmentsAfterTheStreamPauses()
    {
        Assert.Equal(
            "一个短回复",
            StreamingTextReveal.NextChunk("", "一个短回复", true));
    }

    [Fact]
    public void DoesNotTreatTheDotInsideAUrlAsASentenceBoundary()
    {
        Assert.Null(StreamingTextReveal.NextChunk(
            "",
            "详情见 https://openai.com/docs",
            false));
    }
}
