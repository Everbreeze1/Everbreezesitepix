import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { COLOR_SWATCHES } from "@/hooks/use-label-catalog";
import { Check } from "lucide-react";

interface Props {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  size?: "sm" | "md";
  align?: "start" | "center" | "end";
}

/** A compact color picker: preset swatch grid + native color wheel + hex input. */
export function ColorPicker({ value, onChange, className, size = "md", align = "start" }: Props) {
  const [open, setOpen] = useState(false);
  const dim = size === "sm" ? "h-6 w-6" : "h-8 w-8";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-lg border border-input bg-background px-2 py-1.5 text-sm transition-colors hover:bg-muted ${className ?? ""}`}
          aria-label="Pick color"
        >
          <span
            className={`${dim} rounded-md border border-border/70 shadow-sm`}
            style={{ backgroundColor: value }}
          />
          <span className="font-mono text-xs uppercase text-muted-foreground">{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-4">
        <div className="mb-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Curated palette
          </p>
          <div className="grid grid-cols-5 gap-2">
            {COLOR_SWATCHES.map((c) => {
              const active = c.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange(c)}
                  className={`relative h-9 w-full rounded-lg border shadow-sm transition-transform hover:scale-105 ${active ? "ring-2 ring-offset-2 ring-foreground/70" : "border-border/60"}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                >
                  {active && (
                    <Check
                      className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow"
                      strokeWidth={3}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Custom color
          </p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
              aria-label="Color wheel"
            />
            <Input
              value={value}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
                  onChange(v.startsWith("#") ? v : `#${v}`);
                }
              }}
              className="h-10 flex-1 font-mono text-sm uppercase"
              maxLength={7}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
