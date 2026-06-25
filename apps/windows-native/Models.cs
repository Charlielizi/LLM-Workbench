namespace AIHub.Windows;

public enum ProviderId
{
    ChatGpt,
    Claude,
    Doubao,
    Kimi,
    DeepSeek,
    Hunyuan,
    Qianwen,
}

public enum AttachmentKind { Image, Pdf, Word, Excel, PowerPoint, Text }
public enum ProviderMode { WebSearch, Reasoning, ImageUnderstanding, ImageGeneration, Coding, Documents }

public sealed record OutgoingAttachment(
    string Id,
    string Path,
    string Name,
    AttachmentKind Kind,
    long Size);

public sealed record ProviderSendRequest(
    string Text,
    IReadOnlyList<OutgoingAttachment> Attachments,
    IReadOnlySet<ProviderMode> Modes,
    string? Model = null);

public sealed record ProviderModeState(
    ProviderMode Mode,
    string Label,
    bool Enabled);

public sealed record ProviderModelState(
    string Id,
    string Label);

public sealed record ProviderCapabilitySnapshot(
    HashSet<AttachmentKind> Attachments,
    List<ProviderModeState> Modes,
    string? Model = null,
    List<ProviderModelState>? Models = null,
    bool MultipleAttachments = false,
    List<string>? AcceptedTypes = null)
{
    public static readonly ProviderCapabilitySnapshot Empty =
        new([], [], Models: [], AcceptedTypes: []);
}

public sealed record ProviderModeDefinition(
    ProviderMode Mode,
    string Label,
    string[] MatchLabels,
    string[]? OpenerLabels = null,
    string[]? DisabledLabels = null);

public sealed record ProviderCapabilities(
    bool TextChat,
    bool StopGeneration,
    bool Retry,
    bool EditAndResend,
    IReadOnlySet<AttachmentKind> Attachments,
    IReadOnlySet<ProviderMode> Modes);

public sealed record ProviderDefinition(
    ProviderId Id,
    string Label,
    string LoginUrl,
    string[] AllowedOrigins,
    string[] ComposerSelectors,
    string[] SubmitSelectors,
    string[] StopSelectors,
    string[] AssistantSelectors,
    string[] LoginMarkers,
    string[] AuthBlockerSelectors,
    string[] ConversationDocumentSelectors,
    bool SubmitWithEnter,
    string AccentColor,
    string Glyph,
    ProviderCapabilities Capabilities,
    string[] FileInputSelectors,
    string[] AttachmentControlSelectors,
    ProviderModeDefinition[] ModeDefinitions,
    string[] ModelControlSelectors);

public sealed record ConversationRecord(
    string Id,
    ProviderId Provider,
    string Title,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    bool IsPinned = false,
    bool IsArchived = false,
    string Draft = "");

public sealed record MessageRecord(
    string Id,
    string ConversationId,
    ProviderId Provider,
    string Role,
    string Text,
    string Status,
    DateTimeOffset CreatedAt,
    string? ParentMessageId = null,
    string? StopReason = null,
    string? ErrorCode = null,
    string? ModeSnapshot = null,
    string? Html = null,
    string? ModelSnapshot = null);

public sealed record AttachmentRecord(
    string Id,
    string MessageId,
    string LocalPath,
    string Name,
    AttachmentKind Kind,
    long Size,
    string Status,
    string? Error = null);

public sealed record ProviderBridgeEvent(
    string Type,
    string? MessageId = null,
    string? Text = null,
    string? Html = null,
    bool? Authenticated = null,
    string? Reason = null,
    double? X = null,
    double? Y = null,
    string? ActionId = null,
    ProviderCapabilitySnapshot? Capabilities = null);

public sealed record AdapterAuditCandidate(
    string Selector,
    string Tag,
    string Text,
    int Score);

public sealed record AdapterAuditReport(
    ProviderId Provider,
    string Host,
    bool Authenticated,
    string Status,
    string? BridgeText,
    string? Error,
    IReadOnlyList<AdapterAuditCandidate> Candidates,
    DateTimeOffset CapturedAt,
    ProviderCapabilitySnapshot? Capabilities = null);
