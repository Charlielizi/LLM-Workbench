namespace AIHub.Windows;

public static class StreamingTextReveal
{
    private const int PreferredChunkLength = 44;
    private const int MaximumChunkLength = 76;

    public static string? NextChunk(
        string displayed,
        string available,
        bool streamIsQuiet)
    {
        if (available.Length <= displayed.Length && available == displayed)
            return null;
        if (!available.StartsWith(displayed, StringComparison.Ordinal))
            return available;

        var start = displayed.Length;
        var remaining = available.Length - start;
        if (remaining <= 0) return null;

        var searchEnd = Math.Min(available.Length, start + MaximumChunkLength);
        for (var index = start; index < searchEnd; index++)
        {
            if (!IsNaturalBoundary(available, index)) continue;
            var end = IncludeFollowingNewline(available, index + 1);
            if (end - start >= 4 || available[index] == '\n')
                return available[..end];
        }

        if (remaining >= PreferredChunkLength)
        {
            var end = Math.Min(available.Length, start + PreferredChunkLength);
            while (end < searchEnd && !char.IsWhiteSpace(available[end - 1]))
                end++;
            if (end < available.Length &&
                char.IsHighSurrogate(available[end - 1]) &&
                char.IsLowSurrogate(available[end]))
            {
                end++;
            }
            return available[..end];
        }

        return streamIsQuiet ? available : null;
    }

    private static bool IsNaturalBoundary(string text, int index)
    {
        var character = text[index];
        if (character is '\n' or '。' or '！' or '？' or '；')
            return true;
        if (character is not ('.' or '!' or '?' or ';'))
            return false;
        return index == text.Length - 1 || char.IsWhiteSpace(text[index + 1]);
    }

    private static int IncludeFollowingNewline(string text, int end)
    {
        while (end < text.Length && text[end] is '\r' or '\n')
            end++;
        return end;
    }
}
