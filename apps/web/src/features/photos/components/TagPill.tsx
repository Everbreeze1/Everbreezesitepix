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
function readableText(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  // Perceived luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0b0b0b" : "#ffffff";
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
  const sizing =
    size === "lg"
      ? "px-3 py-1.5 text-sm gap-1.5"
      : size === "sm"
        ? "px-2 py-0.5 text-[11px] gap-1"
        : "px-2.5 py-1 text-xs gap-1.5";
  const dotSize = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold shadow-sm ring-1 ring-black/10 ${sizing} ${className ?? ""}`}
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
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}
