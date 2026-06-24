using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace AIHub.Windows;

public sealed class TextPromptWindow : Window
{
    private readonly TextBox _input;
    public string Value => _input.Text;

    public TextPromptWindow(string title, string value)
    {
        Title = title;
        Width = 420;
        Height = 160;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.NoResize;
        Background = Brushes.White;
        Foreground = Brushes.Black;

        _input = new TextBox
        {
            Text = value,
            Margin = new Thickness(16),
            FontSize = 15,
            Foreground = Brushes.Black,
            Background = Brushes.White,
        };
        var ok = new Button { Content = "确定", Width = 84, IsDefault = true };
        ok.Click += (_, _) => { DialogResult = true; Close(); };
        var cancel = new Button { Content = "取消", Width = 84, IsCancel = true };
        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(12),
        };
        buttons.Children.Add(cancel);
        buttons.Children.Add(ok);
        var panel = new DockPanel();
        DockPanel.SetDock(buttons, Dock.Bottom);
        panel.Children.Add(buttons);
        panel.Children.Add(_input);
        Content = panel;
        Loaded += (_, _) => { _input.Focus(); _input.SelectAll(); };
    }
}
