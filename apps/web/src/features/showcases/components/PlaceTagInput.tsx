import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import { mergeServiceArea, serviceAreaKey } from "@sitepix/shared";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

/**
 * The towns a contractor works in, picked off a real places list.
 *
 * These chips are not private notes: they become the filter row beside the
 * map, the "areas served" list in the footer, and the phrases the site gets
 * found by. Typed freehand they drift - "Sacramento" one week, "Sacramento,
 * CA" the next, "Sacremento" the week after - and all three ship, so the
 * footer names the same town three times and one of them is a typo on a public
 * page.
 *
 * So the list comes from Google Places, restricted to towns and cities. What
 * gets stored is still a plain string, the same as before: this is an input
 * that helps you type, not a new kind of data. Freehand entry keeps working,
 * because the whole thing degrades to a plain chip input when Maps is
 * unavailable, and because a service area is sometimes a county or a nickname
 * that no gazetteer will offer.
 */
export function PlaceTagInput({
  value,
  onChange,
  placeholder,
  max = 40,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const sessionToken = useRef<any>(null);

  useEffect(() => {
    loadGoogleMaps()
      .then(async () => {
        await (window as any).google.maps.importLibrary("places");
        setReady(true);
      })
      .catch(() => setUnavailable(true));
  }, []);

  useEffect(() => {
    if (!ready || !open || draft.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = (window as any).google.maps
          .places;
        if (!sessionToken.current) sessionToken.current = new AutocompleteSessionToken();
        const { suggestions: s } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: draft,
          sessionToken: sessionToken.current,
          // Towns only. Without this the list fills with the pizza place on the
          // corner, and a service area of "Round Table Pizza" is worse than a
          // typo because it looks deliberate.
          includedPrimaryTypes: ["locality", "postal_town", "administrative_area_level_3"],
        });
        setSuggestions(s ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [draft, ready, open]);

  const full = value.length >= max;

  /** One place through which every addition passes, typed or picked. */
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // "Sacramento, CA" pasted whole is one place, not two chips - but
    // "Sacramento, Elk Grove, Roseville" is three. A two-letter tail is a
    // state code; anything longer is another town.
    const asOne =
      parts.length === 2 && parts[1].length <= 3 ? [`${parts[0]}, ${parts[1].toUpperCase()}`] : [];
    let next = value;
    for (const part of asOne.length ? asOne : parts) {
      if (next.length >= max) break;
      next = mergeServiceArea(next, part);
    }
    if (next !== value) onChange(next);
    setDraft("");
    setSuggestions([]);
  };

  const pick = (sug: any) => {
    const pred = sug.placePrediction;
    const town = pred?.mainText?.text ?? pred?.text?.text ?? "";
    if (!town) return;
    // "CA, USA" - the state is the part worth keeping, and it is what makes
    // two towns of the same name distinguishable in the list.
    const region = (pred?.secondaryText?.text ?? "").split(",")[0].trim();
    // A new token per accepted suggestion is how Places sessions are billed.
    sessionToken.current = null;
    add(region && region.toLowerCase() !== town.toLowerCase() ? `${town}, ${region}` : town);
    setOpen(false);
  };

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

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

      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={draft}
          disabled={full}
          className="pl-9"
          autoComplete="off"
          placeholder={full ? `Limit of ${max} reached` : placeholder}
          onChange={(e) => {
            setOpen(true);
            if (e.target.value.endsWith(",")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          // Delayed so a click on a suggestion lands before the list closes.
          onBlur={() => window.setTimeout(() => setOpen(false), 180)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              // Enter takes the highlighted-by-default first suggestion when
              // there is one, so the fast path produces a real place name
              // rather than whatever was half-typed.
              if (suggestions.length) pick(suggestions[0]);
              else add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value[value.length - 1]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {ready && open && draft.trim().length >= 2 && suggestions.length === 0 && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}

        {open && suggestions.length > 0 && (
          <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
            {suggestions.map((s, i) => {
              const pred = s.placePrediction;
              const town = pred?.mainText?.text ?? pred?.text?.text ?? "";
              const region = pred?.secondaryText?.text ?? "";
              const already = value.some((v) => serviceAreaKey(v) === serviceAreaKey(town));
              return (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent",
                    already && "opacity-60",
                  )}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{town}</span>
                  {region && (
                    <span className="shrink-0 text-xs text-muted-foreground">{region}</span>
                  )}
                  {already && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Added
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {unavailable
          ? "Suggestions are unavailable right now - type a town and press Enter."
          : "Start typing a town and pick it from the list. Near-duplicates are merged."}
      </p>
    </div>
  );
}
