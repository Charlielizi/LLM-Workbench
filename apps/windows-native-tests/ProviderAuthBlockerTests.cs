namespace AIHub.Windows.Tests;

public sealed class ProviderAuthBlockerTests
{
    [Fact]
    public void HunyuanUsesAuthBlockersAndNoVerifiedAttachmentControl()
    {
        var hunyuan = ProviderCatalog.Get(ProviderId.Hunyuan);

        Assert.Contains(".agent-dialogue__tool__login", hunyuan.AuthBlockerSelectors);
        Assert.Empty(hunyuan.AttachmentControlSelectors);
    }
}
