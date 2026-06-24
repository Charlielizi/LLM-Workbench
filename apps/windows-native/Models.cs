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
    string[] ConversationDocumentSelectors,
    bool SubmitWithEnter,
    string AccentColor,
    string Glyph,
    ProviderCapabilities Capabilities,
    string[] FileInputSelectors);

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
    string? ModeSnapshot = null);

public sealed record AttachmentRecord(
    string Id,
    string MessageId,
    string Name,
    AttachmentKind Kind,
    long Size,
    string Status,
    string? Error = null);

public sealed record ProviderBridgeEvent(
    string Type,
    string? MessageId = null,
    string? Text = null,
    bool? Authenticated = null,
    string? Reason = null,
    double? X = null,
    double? Y = null);

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
    DateTimeOffset CapturedAt);
