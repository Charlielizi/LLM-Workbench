using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace AIHub.Windows;

public sealed class MarkdownViewer : FlowDocumentScrollViewer
{
    private static readonly FontFamily BodyFont =
        new("Segoe UI Variable Text, Microsoft YaHei UI, Segoe UI");

    private static readonly MarkdownPipeline Pipeline =
        new MarkdownPipelineBuilder().UseAdvancedExtensions().Build();

    public static readonly DependencyProperty MarkdownProperty =
        DependencyProperty.Register(
            nameof(Markdown),
            typeof(string),
            typeof(MarkdownViewer),
            new PropertyMetadata("", OnMarkdownChanged));

    public string Markdown
    {
        get => (string)GetValue(MarkdownProperty);
        set => SetValue(MarkdownProperty, value);
    }

    public MarkdownViewer()
    {
        IsToolBarVisible = false;
        VerticalScrollBarVisibility = ScrollBarVisibility.Disabled;
        HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        Background = Brushes.Transparent;
        Foreground = ThemeService.IsLightTheme()
            ? new SolidColorBrush(Color.FromRgb(24, 32, 42))
            : new SolidColorBrush(Color.FromRgb(244, 246, 250));
        FontFamily = BodyFont;
        FontSize = 16.5;
        Focusable = false;
        TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
        TextOptions.SetTextRenderingMode(this, TextRenderingMode.ClearType);
    }

    public static FlowDocument Render(string markdown)
    {
        var document = new FlowDocument
        {
            PagePadding = new Thickness(0),
            ColumnWidth = double.PositiveInfinity,
            FontFamily = BodyFont,
            FontSize = 16.5,
            Foreground = ThemeService.IsLightTheme()
                ? new SolidColorBrush(Color.FromRgb(24, 32, 42))
                : new SolidColorBrush(Color.FromRgb(244, 246, 250)),
            LineHeight = 27,
        };
        var parsed = Markdig.Markdown.Parse(markdown ?? "", Pipeline);
        foreach (var block in parsed)
            AppendBlock(document.Blocks, block);
        return document;
    }

    private static void OnMarkdownChanged(
        DependencyObject dependencyObject,
        DependencyPropertyChangedEventArgs eventArgs)
    {
        if (dependencyObject is MarkdownViewer viewer)
        {
            viewer.Document = Render(eventArgs.NewValue as string ?? "");
            if (eventArgs.OldValue is string oldText &&
                eventArgs.NewValue is string newText &&
                oldText.Length > 0 &&
                newText.StartsWith(oldText, StringComparison.Ordinal))
            {
                viewer.BeginAnimation(
                    OpacityProperty,
                    new DoubleAnimation(.86, 1, TimeSpan.FromMilliseconds(120))
                    {
                        EasingFunction = new QuadraticEase
                        {
                            EasingMode = EasingMode.EaseOut,
                        },
                    });
            }
        }
    }

    private static void AppendBlock(
        BlockCollection blocks,
        Markdig.Syntax.Block block)
    {
        switch (block)
        {
            case HeadingBlock heading:
            {
                var paragraph = NewParagraph();
                paragraph.FontSize = heading.Level switch
                {
                    1 => 26,
                    2 => 22,
                    3 => 19,
                    _ => 17,
                };
                paragraph.FontWeight = FontWeights.Bold;
                paragraph.Margin = new Thickness(0, 10, 0, 6);
                AppendInline(paragraph.Inlines, heading.Inline);
                blocks.Add(paragraph);
                break;
            }
            case ParagraphBlock paragraphBlock:
            {
                var paragraph = NewParagraph();
                AppendInline(paragraph.Inlines, paragraphBlock.Inline);
                blocks.Add(paragraph);
                break;
            }
            case FencedCodeBlock fenced:
                blocks.Add(CodeBlock(fenced.Lines.ToString(), fenced.Info));
                break;
            case CodeBlock code:
                blocks.Add(CodeBlock(code.Lines.ToString(), null));
                break;
            case QuoteBlock quote:
            {
                var section = new Section
                {
                    Margin = new Thickness(0, 6, 0, 8),
                    Padding = new Thickness(12, 5, 8, 5),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(93, 107, 140)),
                    BorderThickness = new Thickness(3, 0, 0, 0),
                    Foreground = ThemeService.IsLightTheme()
                        ? new SolidColorBrush(Color.FromRgb(71, 82, 99))
                        : new SolidColorBrush(Color.FromRgb(202, 208, 220)),
                };
                foreach (var child in quote)
                    AppendBlock(section.Blocks, child);
                blocks.Add(section);
                break;
            }
            case Markdig.Syntax.ListBlock list:
            {
                var wpfList = new System.Windows.Documents.List
                {
                    MarkerStyle = list.IsOrdered
                        ? TextMarkerStyle.Decimal
                        : TextMarkerStyle.Disc,
                    Margin = new Thickness(20, 4, 0, 8),
                };
                foreach (var child in list.OfType<ListItemBlock>())
                {
                    var item = new ListItem();
                    foreach (var itemBlock in child)
                        AppendBlock(item.Blocks, itemBlock);
                    wpfList.ListItems.Add(item);
                }
                blocks.Add(wpfList);
                break;
            }
            case ThematicBreakBlock:
                blocks.Add(new BlockUIContainer(new Border
                {
                    Height = 1,
                    Margin = new Thickness(0, 10, 0, 10),
                    Background = new SolidColorBrush(Color.FromRgb(62, 69, 85)),
                }));
                break;
            case ContainerBlock container:
                foreach (var child in container)
                    AppendBlock(blocks, child);
                break;
        }
    }

    private static Paragraph NewParagraph() => new()
    {
        Margin = new Thickness(0, 2, 0, 10),
        LineHeight = 27,
    };

    private static Paragraph CodeBlock(string code, string? language)
    {
        var paragraph = new Paragraph
        {
            Margin = new Thickness(0, 7, 0, 10),
            Padding = new Thickness(12),
            Background = ThemeService.IsLightTheme()
                ? new SolidColorBrush(Color.FromRgb(238, 241, 245))
                : new SolidColorBrush(Color.FromRgb(8, 11, 16)),
            Foreground = ThemeService.IsLightTheme()
                ? new SolidColorBrush(Color.FromRgb(30, 38, 48))
                : new SolidColorBrush(Color.FromRgb(220, 225, 234)),
            FontFamily = new FontFamily("Cascadia Mono, Consolas"),
            FontSize = 14,
            LineHeight = 22,
        };
        if (!string.IsNullOrWhiteSpace(language))
        {
            paragraph.Inlines.Add(new Run(language.Trim())
            {
                Foreground = new SolidColorBrush(Color.FromRgb(126, 223, 169)),
                FontSize = 11,
            });
            paragraph.Inlines.Add(new LineBreak());
        }
        paragraph.Inlines.Add(new Run(code.TrimEnd()));
        return paragraph;
    }

    private static void AppendInline(InlineCollection target, ContainerInline? container)
    {
        var current = container?.FirstChild;
        while (current is not null)
        {
            switch (current)
            {
                case LiteralInline literal:
                    target.Add(new Run(literal.Content.ToString()));
                    break;
                case CodeInline code:
                    target.Add(new Run(code.Content)
                    {
                        FontFamily = new FontFamily("Cascadia Mono, Consolas"),
                        Background = new SolidColorBrush(Color.FromRgb(35, 40, 52)),
                        Foreground = new SolidColorBrush(Color.FromRgb(152, 232, 190)),
                    });
                    break;
                case LineBreakInline:
                    target.Add(new LineBreak());
                    break;
                case EmphasisInline emphasis:
                {
                    var span = new Span
                    {
                        FontWeight = emphasis.DelimiterCount >= 2
                            ? FontWeights.Bold
                            : FontWeights.Normal,
                        FontStyle = emphasis.DelimiterCount == 1
                            ? FontStyles.Italic
                            : FontStyles.Normal,
                    };
                    AppendInline(span.Inlines, emphasis);
                    target.Add(span);
                    break;
                }
                case LinkInline link when !link.IsImage:
                {
                    var hyperlink = new Hyperlink();
                    AppendInline(hyperlink.Inlines, link);
                    if (Uri.TryCreate(link.Url, UriKind.Absolute, out var uri))
                    {
                        hyperlink.NavigateUri = uri;
                        hyperlink.RequestNavigate += (_, args) =>
                        {
                            Process.Start(new ProcessStartInfo(args.Uri.AbsoluteUri)
                            {
                                UseShellExecute = true,
                            });
                        };
                    }
                    target.Add(hyperlink);
                    break;
                }
                case ContainerInline nested:
                {
                    var span = new Span();
                    AppendInline(span.Inlines, nested);
                    target.Add(span);
                    break;
                }
            }
            current = current.NextSibling;
        }
    }
}
