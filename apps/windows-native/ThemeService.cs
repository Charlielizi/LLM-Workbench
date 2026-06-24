using Microsoft.Win32;
using System.Windows;
using System.Windows.Media;

namespace AIHub.Windows;

public sealed class ThemeService : IDisposable
{
    public ThemeService()
    {
        Apply();
        SystemEvents.UserPreferenceChanged += OnPreferenceChanged;
    }

    private void OnPreferenceChanged(object sender, UserPreferenceChangedEventArgs e) =>
        Application.Current.Dispatcher.Invoke(Apply);

    public void Apply()
    {
        var light = IsLightTheme();
        Set("AppBackground", light ? "#F5F6F8" : "#0E1016");
        Set("PanelBackground", light ? "#FFFFFF" : "#11141B");
        Set("SurfaceBackground", light ? "#F0F2F5" : "#181C26");
        Set("HoverBackground", light ? "#E4E8EE" : "#232936");
        Set("PrimaryText", light ? "#18202A" : "#F4F6FA");
        Set("SecondaryText", light ? "#647083" : "#9BA2B4");
        Set("BorderBrush", light ? "#D7DCE4" : "#2A3040");
    }

    public static bool IsLightTheme()
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return Convert.ToInt32(key?.GetValue("AppsUseLightTheme") ?? 1) != 0;
    }

    private static void Set(string key, string color) =>
        Application.Current.Resources[key] =
            new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));

    public void Dispose() => SystemEvents.UserPreferenceChanged -= OnPreferenceChanged;
}
