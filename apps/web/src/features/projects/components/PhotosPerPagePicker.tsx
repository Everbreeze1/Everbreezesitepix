import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Photos per PDF page, drawn as the page it produces.
 *
 * This was four numbered buttons, which tells you nothing about what you are
 * choosing - "3" does not read as "three stacked down a page". Showing the
 * layout is the whole point of the setting, and the setting is the answer to
 * every report that came out at one picture per sheet.
 *
 * Shared by the New Report dialog and the builder so the control the author
 * meets first is the control they keep.
 */
export function PhotosPerPagePicker({
  value,
  onChange,
  label = "Photos per page",
  hint = true,
}: {
  value: 1 | 2 | 3 | 4;
  onChange: (v: 1 | 2 | 3 | 4) => void;
  label?: string;
  /** Set false where the surrounding copy already explains the page model. */
  hint?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-2 grid max-w-md grid-cols-4 gap-2">
        {([1, 2, 3, 4] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            aria-label={`${n} photo${n > 1 ? "s" : ""} per page`}
            className={cn(
              "rounded-md border px-2 py-2 transition",
              value === n
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50",
            )}
          >
            <span className="mx-auto flex h-9 w-7 flex-col gap-0.5 rounded-[3px] border border-current p-0.5 opacity-70">
              {Array.from({ length: n }).map((_, i) => (
                <span key={i} className="flex-1 rounded-[1px] bg-current" />
              ))}
            </span>
            <span className="mt-1 block text-center text-xs font-medium">{n}</span>
          </button>
        ))}
      </div>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground">
          {value <= 2 ? "Captions render beside each photo." : "Captions render below each photo."}{" "}
          Each section starts a new page, then its photos fill pages {value} at a time.
        </p>
      )}
    </div>
  );
}
