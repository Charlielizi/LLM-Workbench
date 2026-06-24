using System.Text.Json;
using System.Text.RegularExpressions;

namespace AIHub.Windows;

public static partial class DoubaoBriefExtractor
{
    public static IReadOnlyList<string> Extract(string payload)
    {
        var result = new List<string>();
        TryParseJson(payload, result);

        foreach (var line in payload.Split('\n'))
        {
            var candidate = line.Trim();
            if (candidate.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                candidate = candidate[5..].Trim();
            if (candidate.Length > 1)
                TryParseJson(candidate, result);
        }

        if (result.Count == 0)
        {
            foreach (Match match in BriefPattern().Matches(payload))
            {
                try
                {
                    var decoded = JsonSerializer.Deserialize<string>($"\"{match.Groups[1].Value}\"");
                    AddCandidate(decoded, result);
                }
                catch
                {
                    // Ignore malformed fragments from streamed response chunks.
                }
            }
        }

        return result.Distinct(StringComparer.Ordinal).ToList();
    }

    private static void TryParseJson(string value, List<string> result)
    {
        try
        {
            using var document = JsonDocument.Parse(value);
            Visit(document.RootElement, result);
        }
        catch (JsonException)
        {
            // A provider response can be SSE or a partial stream; regex fallback
            // handles a complete escaped brief without retaining the payload.
        }
    }

    private static void Visit(JsonElement element, List<string> result)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (property.NameEquals("brief") &&
                        property.Value.ValueKind == JsonValueKind.String)
                    {
                        AddCandidate(property.Value.GetString(), result);
                    }
                    else
                    {
                        Visit(property.Value, result);
                    }
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                    Visit(item, result);
                break;
            case JsonValueKind.String:
                var nested = element.GetString();
                if (!string.IsNullOrWhiteSpace(nested) &&
                    nested.TrimStart().StartsWith('{'))
                {
                    TryParseJson(nested, result);
                }
                break;
        }
    }

    private static void AddCandidate(string? text, List<string> result)
    {
        var value = text is null ? null : TextEncodingRepair.Normalize(text);
        if (string.IsNullOrWhiteSpace(value) || value.Length > 200_000)
            return;
        result.Add(value);
    }

    [GeneratedRegex("\"brief\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"",
        RegexOptions.Compiled | RegexOptions.CultureInvariant)]
    private static partial Regex BriefPattern();
}
