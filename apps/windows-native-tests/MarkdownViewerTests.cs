using System.Windows.Documents;

namespace AIHub.Windows.Tests;

public sealed class MarkdownViewerTests
{
    [Fact]
    public void RendersHeadingsListsCodeAndLinks()
    {
        const string markdown = """
            ## 标题

            - 第一项
            - 第二项

            **粗体** 和 `code`

            ```csharp
            Console.WriteLine("hello");
            ```

            [OpenAI](https://openai.com)
            """;

        var document = MarkdownViewer.Render(markdown);

        Assert.Contains(document.Blocks, block =>
            block is Paragraph paragraph && paragraph.FontSize >= 22);
        Assert.Contains(document.Blocks, block =>
            block is System.Windows.Documents.List);
        Assert.Contains(document.Blocks, block =>
            block is Paragraph paragraph &&
            paragraph.FontFamily.Source.Contains("Cascadia"));
        Assert.Contains("Microsoft YaHei UI", document.FontFamily.Source);
    }
}
