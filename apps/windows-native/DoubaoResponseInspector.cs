using System.Text.Json;
using System.Text.RegularExpressions;

namespace AIHub.Windows;

public sealed record ResponseTextCandidate(string Path, string Text);

public static partial class DoubaoResponseInspector
{
    private static readonly string[] SensitivePathParts =
    [
        "token", "cookie", "authorization", "bot_state", "chat_ability",
        "client_report", "agent_id", "chat_id", "user_id", "device",
        "url", "avatar", "name", "scene", "switch",
    ];

    public static IReadOnlyList<ResponseTextCandidate> ExtractCandidates(string payload)
    {
        var result = new List<ResponseTextCandidate>();
        TryParse(payload, "$", result);
        foreach (var line in payload.Split('\n'))
        {
            var candidate = line.Trim();
            if (candidate.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                candidate = candidate[5..].Trim();
            TryParse(candidate, "$sse", result);
        }
        return result
            .Where(item => item.Text.Length is >= 2 and <= 100_000)
            .Where(item => item.Text.Any(character =>
                character is >= '\u3400' and <= '\u9fff'))
            .DistinctBy(item => $"{item.Path}\n{item.Text}")
            .Take(200)
            .ToList();
    }

    public static async Task WriteSnapshotAsync(
        string directory,
        IReadOnlyCollection<ResponseTextCandidate> candidates,
        string visibleText)
    {
        Directory.CreateDirectory(directory);
        var safeCandidates = candidates
            .OrderByDescending(item => item.Text.Length)
            .Take(100)
            .Select(item => new
            {
                path = item.Path,
                length = item.Text.Length,
                text = item.Text[..Math.Min(item.Text.Length, 4_000)],
            });
        var snapshot = new
        {
            capturedAt = DateTimeOffset.Now,
            visibleTextTail = visibleText.Length <= 6_000
                ? visibleText
                : visibleText[^6_000..],
            responseCandidates = safeCandidates,
        };
        var path = Path.Combine(directory, "doubao-response-candidates.json");
        await File.WriteAllTextAsync(
            path,
            JsonSerializer.Serialize(snapshot, new JsonSerializerOptions
            {
                WriteIndented = true,
            }));
    }

    private static void TryParse(
        string payload,
        string root,
        List<ResponseTextCandidate> result)
    {
        if (string.IsNullOrWhiteSpace(payload)) return;
        try
        {
            using var document = JsonDocument.Parse(payload);
            Visit(document.RootElement, root, result);
        }
        catch (JsonException)
        {
            foreach (Match match in TextFieldPattern().Matches(payload))
            {
                var key = match.Groups[1].Value;
                if (IsSensitive(key)) continue;
                try
                {
                    var decoded = JsonSerializer.Deserialize<string>(
                        $"\"{match.Groups[2].Value}\"");
                    Add($"{root}.{key}", decoded, result);
                }
                catch
                {
                    // Ignore incomplete streamed JSON fragments.
                }
            }
        }
    }

    private static void Visit(
        JsonElement element,
        string path,
        List<ResponseTextCandidate> result)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (IsSensitive(property.Name)) continue;
                    Visit(property.Value, $"{path}.{property.Name}", result);
                }
                break;
            case JsonValueKind.Array:
                var index = 0;
                foreach (var child in element.EnumerateArray())
                    Visit(child, $"{path}[{index++}]", result);
                break;
            case JsonValueKind.String:
                var value = element.GetString();
                Add(path, value, result);
                if (!string.IsNullOrWhiteSpace(value) &&
                    value.TrimStart().StartsWith('{'))
                {
                    TryParse(value, $"{path}.$json", result);
                }
                break;
        }
    }

    private static void Add(
        string path,
        string? value,
        List<ResponseTextCandidate> result)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        result.Add(new(path, TextEncodingRepair.Normalize(value)));
    }

    private static bool IsSensitive(string path) =>
        SensitivePathParts.Any(part =>
            path.Contains(part, StringComparison.OrdinalIgnoreCase));

    [GeneratedRegex(
        "\"([A-Za-z_][A-Za-z0-9_]*)\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"",
        RegexOptions.Compiled | RegexOptions.CultureInvariant)]
    private static partial Regex TextFieldPattern();
}
