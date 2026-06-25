using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using Markdig;
using Markdig.Extensions.Tables;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace AIHub.Windows;

public sealed class MarkdownViewer : FlowDocumentScrollViewer
{
    private static readonly FontFamily BodyFont =
        new("Segoe UI Variable Text, Microsoft YaHei UI, Segoe UI");

    private static readonly HttpClient Http = new();
    private static readonly ConcurrentDictionary<string, BitmapImage> ImageCache = new();

    private static readonly MarkdownPipeline Pipeline =
        new MarkdownPipelineBuilder()
            .UseAdvancedExtensions()
            .UseMathematics()
            .Build();

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
            case Markdig.Extensions.Mathematics.MathBlock math:
                blocks.Add(MathDisplayBlock(math.Lines.ToString()));
                break;
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
            case Markdig.Extensions.Tables.Table table:
                blocks.Add(RenderTable(table));
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

    private static Paragraph MathDisplayBlock(string latex)
    {
        return new Paragraph(new Run(latex.Trim()))
        {
            Margin = new Thickness(0, 8, 0, 10),
            Padding = new Thickness(14, 10, 14, 10),
            Background = ThemeService.IsLightTheme()
                ? new SolidColorBrush(Color.FromRgb(247, 243, 252))
                : new SolidColorBrush(Color.FromRgb(28, 24, 40)),
            BorderBrush = ThemeService.IsLightTheme()
                ? new SolidColorBrush(Color.FromRgb(200, 180, 230))
                : new SolidColorBrush(Color.FromRgb(80, 65, 120)),
            BorderThickness = new Thickness(1),
            TextAlignment = TextAlignment.Center,
            FontFamily = new FontFamily("Cambria Math, Latin Modern Math, STIX Two Math"),
            FontSize = 17,
            Foreground = ThemeService.IsLightTheme()
                ? new SolidColorBrush(Color.FromRgb(80, 40, 140))
                : new SolidColorBrush(Color.FromRgb(200, 170, 240)),
        };
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
                case Markdig.Extensions.Mathematics.MathInline math:
                    target.Add(new Run(math.Content.ToString())
                    {
                        FontFamily = new FontFamily("Cambria Math, Cascadia Mono"),
                        FontSize = 15,
                        Foreground = ThemeService.IsLightTheme()
                            ? new SolidColorBrush(Color.FromRgb(100, 60, 160))
                            : new SolidColorBrush(Color.FromRgb(190, 160, 230)),
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
                case LinkInline link when link.IsImage:
                {
                    if (string.IsNullOrWhiteSpace(link.Url)) break;
                    var image = new Image
                    {
                        MaxWidth = 620,
                        Margin = new Thickness(0, 6, 0, 6),
                        Stretch = Stretch.Uniform,
                        StretchDirection = StretchDirection.DownOnly,
                    };
                    var tooltip = link.Title ?? link.Url;
                    if (!string.IsNullOrWhiteSpace(tooltip))
                        image.ToolTip = tooltip;
                    if (ImageCache.TryGetValue(link.Url, out var cached))
                    {
                        image.Source = cached;
                    }
                    else
                    {
                        _ = LoadImageAsync(link.Url, image);
                    }
                    target.Add(new InlineUIContainer(image));
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

    private static async Task LoadImageAsync(string url, Image image)
    {
        try
        {
            var bytes = await Http.GetByteArrayAsync(url);
            var bitmap = new BitmapImage();
            using (var stream = new MemoryStream(bytes))
            {
                bitmap.BeginInit();
                bitmap.CacheOption = BitmapCacheOption.OnLoad;
                bitmap.StreamSource = stream;
                bitmap.EndInit();
                bitmap.Freeze();
            }
            ImageCache[url] = bitmap;
            image.Source = bitmap;
        }
        catch
        {
            // Image load failed silently
        }
    }

    private static BlockUIContainer RenderTable(Markdig.Extensions.Tables.Table table)
    {
        var grid = new Grid
        {
            Margin = new Thickness(0, 6, 0, 10),
        };

        var rows = table.OfType<Markdig.Extensions.Tables.TableRow>().ToList();
        if (rows.Count == 0)
            return new BlockUIContainer(grid);

        var colCount = rows[0].Count;
        for (var i = 0; i < colCount; i++)
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var isHeader = true;
        foreach (var row in rows)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var rowIndex = grid.RowDefinitions.Count - 1;
            for (var ci = 0; ci < Math.Min(row.Count, colCount); ci++)
            {
                var cell = (Markdig.Extensions.Tables.TableCell)row[ci];
                var text = new TextBlock
                {
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(8, 5, 8, 5),
                    VerticalAlignment = VerticalAlignment.Center,
                    FontSize = 14,
                };
                if (isHeader)
                {
                    text.FontWeight = FontWeights.SemiBold;
                    text.Background = ThemeService.IsLightTheme()
                        ? new SolidColorBrush(Color.FromRgb(238, 241, 245))
                        : new SolidColorBrush(Color.FromRgb(30, 36, 50));
                }
                var paragraph = new Paragraph();
                foreach (var block in cell)
                    if (block is ParagraphBlock pb)
                        AppendInline(paragraph.Inlines, pb.Inline);
                text.Inlines.AddRange(paragraph.Inlines.ToList());
                Grid.SetRow(text, rowIndex);
                Grid.SetColumn(text, ci);
                grid.Children.Add(text);
            }
            if (isHeader)
            {
                grid.RowDefinitions[^1].MinHeight = 32;
                isHeader = false;
            }
        }

        // Horizontal borders between rows
        var borderColor = ThemeService.IsLightTheme()
            ? Color.FromRgb(218, 224, 232)
            : Color.FromRgb(55, 62, 78);
        for (var ri = 0; ri < grid.RowDefinitions.Count; ri++)
        {
            var border = new Border
            {
                BorderBrush = new SolidColorBrush(borderColor),
                BorderThickness = new Thickness(0, ri == 0 ? 1 : 0, 0, 1),
            };
            Grid.SetRow(border, ri);
            Grid.SetColumnSpan(border, colCount);
            Panel.SetZIndex(border, -1);
            grid.Children.Add(border);
        }
        return new BlockUIContainer(grid);
    }
}
