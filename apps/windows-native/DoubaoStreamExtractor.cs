using System.Text.Json;

namespace AIHub.Windows;

public sealed record DoubaoStreamChunk(
    string Text,
    bool IsCompleted = false,
    string? MessageId = null);

public static class DoubaoStreamExtractor
{
    public static IReadOnlyList<DoubaoStreamChunk> Extract(string payload)
    {
        var result = new List<DoubaoStreamChunk>();
        foreach (var candidate in SplitEvents(payload))
        {
            try
            {
                using var document = JsonDocument.Parse(candidate);
                Visit(document.RootElement, "$", result);
            }
            catch (JsonException)
            {
                // Ignore incomplete streamed events; a later response event will
                // contain a complete JSON object.
            }
        }
        return result;
    }

    private static IEnumerable<string> SplitEvents(string payload)
    {
        yield return payload;
        foreach (var line in payload.Split('\n'))
        {
            var candidate = line.Trim();
            if (candidate.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                candidate = candidate[5..].Trim();
            if (candidate.StartsWith('{'))
                yield return candidate;
        }
    }

    private static void Visit(
        JsonElement element,
        string path,
        List<DoubaoStreamChunk> result)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            string? directText = null;
            string? messageId = null;
            var completed = false;

            foreach (var property in element.EnumerateObject())
            {
                if (property.NameEquals("text") &&
                    property.Value.ValueKind == JsonValueKind.String &&
                    IsAssistantTextPath(path))
                {
                    directText = property.Value.GetString();
                }
                else if (property.Name is "message_id" or "local_message_id" &&
                         property.Value.ValueKind == JsonValueKind.String)
                {
                    messageId = property.Value.GetString();
                }
                else if (property.Name is "is_finish" or "is_finished" or "finish" &&
                         IsTrue(property.Value))
                {
                    completed = true;
                }
                else if (property.Name is "event_type" or "type" &&
                         property.Value.ValueKind == JsonValueKind.String)
                {
                    var type = property.Value.GetString();
                    completed |= type is "done" or "finish" or "completed" or "message_end";
                }
            }

            if (!string.IsNullOrWhiteSpace(directText))
            {
                result.Add(new(
                    TextEncodingRepair.Normalize(directText),
                    completed,
                    messageId));
            }

            foreach (var property in element.EnumerateObject())
            {
                Visit(property.Value, $"{path}.{property.Name}", result);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            var index = 0;
            foreach (var child in element.EnumerateArray())
                Visit(child, $"{path}[{index++}]", result);
        }
    }

    private static bool IsAssistantTextPath(string path) =>
        path == "$" ||
        path.EndsWith(".patch_value", StringComparison.Ordinal) ||
        path.Contains(".patch_op[", StringComparison.Ordinal);

    private static bool IsTrue(JsonElement element) =>
        element.ValueKind == JsonValueKind.True ||
        element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var number) && number == 1 ||
        element.ValueKind == JsonValueKind.String &&
        element.GetString() is "1" or "true" or "done";
}
