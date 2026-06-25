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
    public void DoubaoUsesItsCurrentNestedWebsiteTools()
    {
        var definition = ProviderCatalog.Get(ProviderId.Doubao);

        Assert.Contains(
            definition.ModeDefinitions,
            mode => mode.Mode == ProviderMode.Reasoning &&
                mode.MatchLabels.Contains("专家") &&
                mode.OpenerLabels?.Contains("快速") == true &&
                mode.DisabledLabels?.Contains("快速") == true);
        Assert.Contains(
            definition.ModeDefinitions,
            mode => mode.Mode == ProviderMode.ImageGeneration &&
                mode.OpenerLabels?.Contains("更多") == true);
        Assert.Contains(
            definition.ModeDefinitions,
            mode => mode.Mode == ProviderMode.Coding &&
                mode.MatchLabels.Contains("编程"));
        Assert.Contains(
            definition.ModeDefinitions,
            mode => mode.Mode == ProviderMode.WebSearch &&
                mode.MatchLabels.Contains("深入研究"));
    }

    [Fact]
    public void WebsiteAdaptersMatchObservedComposerControls()
    {
        var chatGpt = ProviderCatalog.Get(ProviderId.ChatGpt);
        Assert.Contains("#composer-plus-btn", chatGpt.AttachmentControlSelectors);
        Assert.Contains(
            "[data-testid='model-switcher-dropdown-button']",
            chatGpt.ModelControlSelectors);

        var kimi = ProviderCatalog.Get(ProviderId.Kimi);
        Assert.Contains(".toolkit-trigger-btn", kimi.AttachmentControlSelectors);
        Assert.Contains(".current-model", kimi.ModelControlSelectors);
        Assert.Empty(kimi.ModeDefinitions);

        var deepSeek = ProviderCatalog.Get(ProviderId.DeepSeek);
        Assert.Contains(
            deepSeek.ModeDefinitions,
            mode => mode.MatchLabels.Contains("智能搜索"));

        var hunyuan = ProviderCatalog.Get(ProviderId.Hunyuan);
        Assert.Contains(
            "[aria-label='模型选择']",
            hunyuan.ModelControlSelectors);

        var qianwen = ProviderCatalog.Get(ProviderId.Qianwen);
        Assert.Contains(
            qianwen.ModeDefinitions,
            mode => mode.MatchLabels.Contains("PPT创作"));
        Assert.Contains(
            "button[aria-label='添加附件']",
            qianwen.AttachmentControlSelectors);
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
    public void BridgePreservesRenderedAssistantTypography()
    {
        var script = ProviderBridgeScript.Build(
            ProviderCatalog.Get(ProviderId.Hunyuan));

        Assert.Contains("getComputedStyle(source)", script);
        Assert.Contains("font-weight", script);
        Assert.Contains("list-style-type", script);
        Assert.Contains("background-color", script);
        Assert.Contains("annotation[encoding*='tex']", script);
        Assert.Contains("replacement.className = \"aihub-math\"", script);
        Assert.Contains("container.classList.add(\"aihub-provider-math\")", script);
        Assert.Contains("const style = [...computed]", script);
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

        Assert.Contains("send.click.required", script);
        Assert.Contains("send.enter.required", script);
        Assert.Contains("message.dispatched", script);
        Assert.Contains("sentSuccessfully", script);
        Assert.Contains("did not accept the send action", script);
    }
}
