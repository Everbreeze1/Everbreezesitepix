import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Comma/Enter-separated chips for the small lists that drive the portfolio
 * site: services, areas served, products used.
 *
 * These become filter facets and footer copy on a public page, so duplicates
 * and stray whitespace are stripped on the way in rather than being cleaned up
 * at render time in three different components.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  max = 24,
  suggestions = [],
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  /** One-tap adds for values already in use elsewhere in the account. */
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    // Pasting "Roofing, Siding, Gutters" should produce three chips, not one.
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  };

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));
  const unused = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-bold text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove ${tag}`}
                className="grid h-4 w-4 place-items-center rounded-full transition hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Input
        value={draft}
        onChange={(e) => {
          // Typing the comma commits the chip immediately — waiting for Enter
          // after a comma is the single most common way these inputs feel broken.
          if (e.target.value.includes(",")) add(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            remove(value[value.length - 1]);
          }
        }}
        onBlur={() => add(draft)}
        placeholder={value.length >= max ? `Limit of ${max} reached` : placeholder}
        disabled={value.length >= max}
      />

      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Suggested
          </span>
          {unused.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className={cn(
                "rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground",
                "transition hover:border-primary/50 hover:text-foreground",
              )}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
