namespace AIHub.Windows.Tests;

public sealed class TextEncodingRepairTests
{
    [Theory]
    [InlineData("涓冩ā鍨嬪伐浣滃彴", "七模型工作台")]
    [InlineData("鏍囬", "标题")]
    [InlineData("浣犲ソ", "你好")]
    public void RepairsUtf8TextDecodedAsGb18030(string damaged, string expected)
    {
        Assert.Equal(expected, TextEncodingRepair.Normalize(damaged));
    }

    [Fact]
    public void LeavesNormalChineseUntouched()
    {
        const string text = "这是一段正常的 AI 回复。";
        Assert.Equal(text, TextEncodingRepair.Normalize(text));
    }
}
