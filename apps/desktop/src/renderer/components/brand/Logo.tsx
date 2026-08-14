export type LogoVariant = "full" | "icon" | "wordmark";
export type LogoColor = "primary" | "white" | "black";

interface LogoProps {
  variant?: LogoVariant;
  color?: LogoColor;
  size?: number;
  className?: string;
}

const colors: Record<LogoColor, { ink: string; rail: string; accent: string; spark: string }> = {
  primary: { ink: "#0F172A", rail: "#22D3EE", accent: "#F59E0B", spark: "#FFFFFF" },
  white: { ink: "#FFFFFF", rail: "#67E8F9", accent: "#FBBF24", spark: "#0F172A" },
  black: { ink: "#000000", rail: "#0891B2", accent: "#D97706", spark: "#FFFFFF" },
};

function Mark({ palette, size }: { palette: (typeof colors)[LogoColor]; size: number }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      height={size}
      viewBox="0 0 48 48"
      width={size}
    >
      <rect fill={palette.ink} height="44" rx="13" width="44" x="2" y="2" />
      <path
        d="M12 14h24M12 24h24M12 34h24"
        stroke={palette.rail}
        strokeLinecap="round"
        strokeWidth="3"
      />
      <circle cx="12" cy="14" fill={palette.accent} r="3" />
      <circle cx="24" cy="24" fill={palette.accent} r="3" />
      <circle cx="36" cy="34" fill={palette.accent} r="3" />
      <path d="m24 17 1.8 5.2L31 24l-5.2 1.8L24 31l-1.8-5.2L17 24l5.2-1.8L24 17Z" fill={palette.spark} />
    </svg>
  );
}

export function Logo({
  variant = "full",
  color = "primary",
  size = 32,
  className,
}: LogoProps) {
  const palette = colors[color];
  const wordmarkColor = color === "white" ? "#FFFFFF" : palette.ink;

  if (variant === "icon") {
    return <Mark palette={palette} size={size} />;
  }

  if (variant === "wordmark") {
    return (
      <span
        className={`inline-flex items-center font-semibold tracking-tight ${className ?? ""}`}
        style={{ color: wordmarkColor, fontSize: size * 0.62, lineHeight: 1 }}
      >
        LLM Workbench
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <Mark palette={palette} size={size} />
      <span
        className="font-semibold tracking-tight"
        style={{ color: wordmarkColor, fontSize: size * 0.62, lineHeight: 1 }}
      >
        LLM Workbench
      </span>
    </span>
  );
}
