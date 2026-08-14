import { useTagColors } from "@/hooks/use-tag-colors";

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const f =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/**
 * Picks whichever of black/white has the higher WCAG contrast ratio against the
 * pill colour. The previous 0.6 perceived-brightness cutoff put white text on
 * mid-tone tags (oranges, teals, mid greens) where black reads far better -
 * a large part of why tags were reported as hard to read.
 */
function readableText(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  // Contrast vs white is 1.05/(L+0.05); vs black it's (L+0.05)/0.05.
  return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? "#0b0b0b" : "#ffffff";
}

function toTitleCase(s: string): string {
  return (s ?? "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

interface PillProps {
  name: string;
  size?: "sm" | "md" | "lg";
  onRemove?: () => void;
  className?: string;
}

export function TagPill({ name, size = "md", onRemove, className }: PillProps) {
  const { colorOf } = useTagColors();
  const bg = colorOf(name);
  const fg = readableText(bg);
  // One step larger across the board - these sit over photography as often as
  // on cards, where the old 11px caption size was the main legibility problem.
  const sizing =
    size === "lg"
      ? "px-3.5 py-1.5 text-base gap-1.5"
      : size === "sm"
        ? "px-2.5 py-1 text-xs gap-1.5"
        : "px-3 py-1 text-sm gap-1.5";
  const dotSize = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  return (
    <span
      className={`inline-flex items-center rounded-full font-extrabold tracking-tight shadow ring-1 ring-black/20 ${sizing} ${className ?? ""}`}
      style={{ background: bg, color: fg }}
    >
      <span
        className={`inline-block rounded-full ${dotSize}`}
        style={{ background: fg, opacity: 0.55 }}
      />
      {toTitleCase(name)}

      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full px-1 leading-none opacity-70 hover:opacity-100"
          style={{ color: fg }}
        >
          ×
        </button>
      )}
    </span>
  );
}

interface RowProps {
  tags: string[];
  size?: "sm" | "md" | "lg";
  onRemove?: (name: string) => void;
  max?: number;
  className?: string;
}

export function TagPillRow({ tags, size, onRemove, max, className }: RowProps) {
  if (!tags?.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const extra = max && tags.length > max ? tags.length - max : 0;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {shown.map((t) => (
        <TagPill key={t} name={t} size={size} onRemove={onRemove ? () => onRemove(t) : undefined} />
      ))}
      {extra > 0 && (
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}
