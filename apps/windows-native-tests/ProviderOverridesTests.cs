namespace AIHub.Windows.Tests;

public sealed class ProviderOverridesTests
{
    [Fact]
    public void QianwenSupportsOverflowMenuModes()
    {
        var openerLabels = ProviderCatalog.Get(ProviderId.Qianwen)
            .ModeDefinitions
            .Where(mode => mode.Mode is ProviderMode.ImageGeneration or
                ProviderMode.Coding or
                ProviderMode.Documents)
            .SelectMany(mode => mode.OpenerLabels ?? [])
            .ToArray();

        Assert.Contains("\u66f4\u591a", openerLabels);
    }
}
