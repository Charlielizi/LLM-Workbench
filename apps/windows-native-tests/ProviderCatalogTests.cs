namespace AIHub.Windows.Tests;

public sealed class ProviderCatalogTests
{
    [Fact]
    public void DefinesSevenIsolatedProviders()
    {
        Assert.Equal(7, ProviderCatalog.All.Count);
        Assert.Equal(
            7,
            ProviderCatalog.All
                .Select(item => item.Id)
                .Distinct()
                .Count());
        Assert.All(ProviderCatalog.All, definition =>
        {
            Assert.StartsWith("https://", definition.LoginUrl);
            Assert.NotEmpty(definition.ComposerSelectors);
            Assert.NotEmpty(definition.AllowedOrigins);
        });
    }

    [Fact]
    public void DoubaoUsesDocumentDeltaAndEnterFallback()
    {
        var doubao = ProviderCatalog.Get(ProviderId.Doubao);
        Assert.True(doubao.SubmitWithEnter);
        Assert.Contains("main", doubao.ConversationDocumentSelectors);
        Assert.Contains(
            doubao.ComposerSelectors,
            selector => selector.Contains("input-engine-container"));
    }

    [Fact]
    public void OnlyVerifiedProviderExposesAttachments()
    {
        Assert.NotEmpty(ProviderCatalog.Get(ProviderId.Doubao).Capabilities.Attachments);
        Assert.All(
            ProviderCatalog.All.Where(item => item.Id != ProviderId.Doubao),
            item => Assert.Empty(item.Capabilities.Attachments));
        Assert.Equal(AttachmentKind.PowerPoint, AttachmentType.FromPath("deck.pptx"));
        Assert.Null(AttachmentType.FromPath("archive.zip"));
    }

    [Fact]
    public void EveryProviderHasAConversationFallback()
    {
        Assert.All(ProviderCatalog.All, definition =>
        {
            Assert.True(definition.SubmitWithEnter);
            Assert.Contains("main", definition.ConversationDocumentSelectors);
            Assert.NotEmpty(definition.AssistantSelectors);
        });
    }

    [Fact]
    public void BridgeUsesSnapshotAndPromptRelativeFallback()
    {
        var script = ProviderBridgeScript.Build(
            ProviderCatalog.Get(ProviderId.Hunyuan));

        Assert.Contains("message.snapshot", script);
        Assert.Contains("textAfterPrompt", script);
        Assert.Contains("setInterval", script);
    }

    [Fact]
    public void BridgeFiltersProviderDisclaimerAndScoresSemanticResponses()
    {
        var script = ProviderBridgeScript.Build(
            ProviderCatalog.Get(ProviderId.Hunyuan));

        Assert.Contains("cleanResponse", script);
        Assert.Contains("semanticResponseText", script);
        Assert.Contains("candidateScore", script);
        Assert.Contains("\\u4ec5\\u4f9b\\u53c2\\u8003", script);
    }

    [Fact]
    public void VerifiedProvidersUseStrictAssistantContainers()
    {
        var kimi = ProviderBridgeScript.Build(ProviderCatalog.Get(ProviderId.Kimi));
        var hunyuan = ProviderBridgeScript.Build(ProviderCatalog.Get(ProviderId.Hunyuan));

        Assert.Contains("\"strictAssistant\":true", kimi);
        Assert.Contains("\"strictAssistant\":true", hunyuan);
        Assert.StartsWith(
            "div.agent-chat__list__item",
            ProviderCatalog.Get(ProviderId.Hunyuan).AssistantSelectors[0]);
    }

    [Fact]
    public void BridgeConfirmsSendAndRequestsTrustedActivation()
    {
        var script = ProviderBridgeScript.Build(
            ProviderCatalog.Get(ProviderId.Hunyuan));

        Assert.Contains("send.activation.required", script);
        Assert.Contains("sentSuccessfully", script);
        Assert.Contains("did not accept the send action", script);
    }
}
