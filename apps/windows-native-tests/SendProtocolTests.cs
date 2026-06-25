using System.Text.Json;

namespace AIHub.Windows.Tests;

public sealed class SendProtocolTests
{
    [Fact]
    public void CapabilitySnapshotDeserializesFromWebsiteBridge()
    {
        const string json = """
            {
              "type": "capabilities.changed",
              "capabilities": {
                "attachments": [0, 1, 5],
                "modes": [
                  { "mode": 1, "label": "深度思考", "enabled": true },
                  { "mode": 0, "label": "联网搜索", "enabled": false }
                ],
                "model": "current",
                "models": [
                  { "id": "current", "label": "Current model" },
                  { "id": "next", "label": "Next model" }
                ],
                "multipleAttachments": true,
                "acceptedTypes": ["image/*", ".pdf"]
              }
            }
            """;

        var message = JsonSerializer.Deserialize<ProviderBridgeEvent>(
            json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        var capabilities = Assert.IsType<ProviderCapabilitySnapshot>(
            message?.Capabilities);
        Assert.Contains(AttachmentKind.Image, capabilities.Attachments);
        Assert.Contains(AttachmentKind.Pdf, capabilities.Attachments);
        Assert.Contains(AttachmentKind.Text, capabilities.Attachments);
        Assert.True(capabilities.MultipleAttachments);
        Assert.Equal(2, capabilities.Models?.Count);
        Assert.Contains(
            capabilities.Modes,
            mode => mode.Mode == ProviderMode.Reasoning && mode.Enabled);
    }

    [Fact]
    public void SendRequestCarriesAttachmentsModesAndModel()
    {
        var request = new ProviderSendRequest(
            "分析图片",
            [
                new OutgoingAttachment(
                    "file",
                    @"C:\images\sample.png",
                    "sample.png",
                    AttachmentKind.Image,
                    1024)
            ],
            new HashSet<ProviderMode>
            {
                ProviderMode.Reasoning,
                ProviderMode.WebSearch,
            },
            "model-x");

        Assert.Equal("分析图片", request.Text);
        Assert.Single(request.Attachments);
        Assert.Contains(ProviderMode.Reasoning, request.Modes);
        Assert.Equal("model-x", request.Model);
    }

    [Fact]
    public void BridgeDetectsCapabilitiesAndWaitsForUploads()
    {
        var script = ProviderBridgeScript.Build(
            ProviderCatalog.Get(ProviderId.Doubao));

        Assert.Contains("capabilities.changed", script);
        Assert.Contains("__aihubConfigureModes", script);
        Assert.Contains("__aihubWaitForAttachments", script);
        Assert.Contains("__aihubPrepareAttachmentInput", script);
        Assert.Contains("__aihubDiscoverModels", script);
        Assert.Contains("__aihubConfigureModel", script);
        Assert.Contains("ui.click.required", script);
        Assert.Contains("ui.click.completed", script);
        Assert.Contains("data-aihub-file-input", script);
        Assert.Contains("composerDistance", script);
        Assert.Contains("Attachment upload did not finish", script);
        Assert.Contains("revealModeControl", script);
        Assert.Contains("openerLabels", script);
        Assert.Contains("disabledLabels", script);
        Assert.Contains("attachmentControlSelectors", script);
        Assert.Contains(".model-item-content", script);
        Assert.Contains("inputMatchesAttachmentMode", script);
        Assert.Contains("attachmentMode = \"document\"", script);
        Assert.Contains("上传文档", script);
        Assert.Contains("上传图片", script);
    }

    [Fact]
    public void AttachmentUploadDoesNotDeserializeTheEntireWebsiteDom()
    {
        var workspace = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (workspace is not null &&
               !Directory.Exists(Path.Combine(workspace.FullName, "apps")))
            workspace = workspace.Parent;
        Assert.NotNull(workspace);
        var source = File.ReadAllText(
            Path.Combine(
                workspace!.FullName,
                "apps", "windows-native", "ProviderRuntime.cs"));

        Assert.Contains(
            "\"DOM.getDocument\", \"\"\"{\"depth\":0,\"pierce\":true}\"\"\"",
            source);
        Assert.DoesNotContain("\"depth\":-1", source);
        Assert.Contains("attachments.GroupBy(AttachmentUploadModeForKind)", source);
        Assert.Contains("window.__aihubPrepareAttachmentInput?.({JsonSerializer.Serialize(attachmentMode)}) ?? false", source);
    }
}
