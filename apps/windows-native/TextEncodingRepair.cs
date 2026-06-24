using System.Text;

namespace AIHub.Windows;

public static class TextEncodingRepair
{
    static TextEncodingRepair()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    public static string Normalize(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        var current = text;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var repaired = new[]
                {
                    TryRepairUtf8ReadAsLatin1(current),
                    TryRepairUtf8ReadAsGb18030(current),
                }
                .Where(candidate => candidate is not null)
                .Cast<string>()
                .OrderByDescending(Score)
                .FirstOrDefault();
            if (repaired is null || !LooksMoreReadable(current, repaired))
                break;
            current = repaired;
        }
        return current;
    }

    private static string? TryRepairUtf8ReadAsGb18030(string text)
    {
        try
        {
            var source = Encoding.GetEncoding(
                "GB18030",
                EncoderFallback.ExceptionFallback,
                DecoderFallback.ExceptionFallback);
            var bytes = source.GetBytes(text);
            return new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (EncoderFallbackException)
        {
            return null;
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }

    private static string? TryRepairUtf8ReadAsLatin1(string text)
    {
        try
        {
            var bytes = new byte[text.Length];
            for (var index = 0; index < text.Length; index++)
            {
                if (!TryGetWindows1252Byte(text[index], out bytes[index]))
                    return null;
            }
            return new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }

    private static bool TryGetWindows1252Byte(char character, out byte value)
    {
        if (character <= byte.MaxValue)
        {
            value = (byte)character;
            return true;
        }
        value = character switch
        {
            '\u20AC' => 0x80,
            '\u201A' => 0x82,
            '\u0192' => 0x83,
            '\u201E' => 0x84,
            '\u2026' => 0x85,
            '\u2020' => 0x86,
            '\u2021' => 0x87,
            '\u02C6' => 0x88,
            '\u2030' => 0x89,
            '\u0160' => 0x8A,
            '\u2039' => 0x8B,
            '\u0152' => 0x8C,
            '\u017D' => 0x8E,
            '\u2018' => 0x91,
            '\u2019' => 0x92,
            '\u201C' => 0x93,
            '\u201D' => 0x94,
            '\u2022' => 0x95,
            '\u2013' => 0x96,
            '\u2014' => 0x97,
            '\u02DC' => 0x98,
            '\u2122' => 0x99,
            '\u0161' => 0x9A,
            '\u203A' => 0x9B,
            '\u0153' => 0x9C,
            '\u017E' => 0x9E,
            '\u0178' => 0x9F,
            _ => 0,
        };
        return value != 0;
    }

    private static int Score(string text)
    {
        var cjk = text.Count(character =>
            character is >= '\u3400' and <= '\u9fff');
        var replacement = text.Count(character => character == '\uFFFD');
        return cjk * 2 - ArtifactCount(text) * 8 - replacement * 20;
    }

    private static bool LooksMoreReadable(string source, string candidate)
    {
        var sourceArtifacts = ArtifactCount(source);
        var candidateArtifacts = ArtifactCount(candidate);
        if (candidateArtifacts < sourceArtifacts) return true;
        var candidateCjk = candidate.Count(character =>
            character is >= '\u3400' and <= '\u9fff');
        var sourceCjk = source.Count(character =>
            character is >= '\u3400' and <= '\u9fff');
        if (candidate.Length * 4 <= source.Length * 3 &&
            candidateCjk > 0 &&
            sourceCjk * 2 >= source.Length)
        {
            return true;
        }
        return sourceArtifacts > 0 && Score(candidate) > Score(source);
    }

    private static int ArtifactCount(string text)
    {
        var count = text.Count(character =>
            character == '\uFFFD' ||
            character is >= '\uE000' and <= '\uF8FF' ||
            character is 'Ã' or 'Â' or 'â' or '€' or '鈥' or '銆' or '锛');
        count += text.Count(character =>
            character > 127 &&
            char.IsLetter(character) &&
            character is not (>= '\u3400' and <= '\u9fff'));
        return count;
    }
}
