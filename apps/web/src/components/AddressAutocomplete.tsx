import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

export interface ParsedAddress {
  formatted: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSelect?: (addr: ParsedAddress) => void;
  id?: string;
  placeholder?: string;
  showIcon?: boolean;
  inputClassName?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  id,
  placeholder,
  showIcon = true,
  inputClassName,
}: Props) {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sessionTokenRef = useRef<any>(null);

  useEffect(() => {
    loadGoogleMaps()
      .then(async () => {
        await (window as any).google.maps.importLibrary("places");
        setReady(true);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (!open || !ready || !value.trim()) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = (window as any).google.maps
          .places;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const { suggestions: s } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value,
          sessionToken: sessionTokenRef.current,
        });
        setSuggestions(s ?? []);
      } catch {
        setSuggestions([]);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [value, open, ready]);

  const handleSelect = async (sug: any) => {
    const pred = sug.placePrediction;
    if (!pred) return;
    setLoading(true);
    try {
      const place = pred.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "addressComponents", "location"] });
      sessionTokenRef.current = null;
      const comps: any[] = place.addressComponents ?? [];
      const get = (type: string, short = false) => {
        const c = comps.find((x) => x.types?.includes(type));
        return (short ? c?.shortText : c?.longText) ?? "";
      };
      const street = `${get("street_number")} ${get("route")}`.trim();
      const city =
        get("locality") || get("postal_town") || get("sublocality") || get("sublocality_level_1");
      const state = get("administrative_area_level_1", true);
      const zip = get("postal_code");
      const formatted = place.formattedAddress ?? pred.text?.text ?? "";
      const loc = (place as any).location;
      const latitude = typeof loc?.lat === "function" ? loc.lat() : (loc?.lat ?? null);
      const longitude = typeof loc?.lng === "function" ? loc.lng() : (loc?.lng ?? null);
      onChange(formatted);
      onSelect?.({ formatted, street, city, state, zip, latitude, longitude });
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        {showIcon && (
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          id={id}
          value={value}
          placeholder={placeholder ?? "Start typing an address…"}
          className={inputClassName ?? (showIcon ? "pl-9 pr-9" : "")}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          autoComplete="off"
        />
        {loading && showIcon && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {suggestions.map((s, i) => {
            const pred = s.placePrediction;
            const main = pred?.mainText?.text ?? pred?.text?.text ?? "";
            const secondary = pred?.secondaryText?.text ?? "";
            return (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s)}
                className="flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{main}</span>
                  {secondary && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {secondary}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Address autocomplete unavailable — type the address manually.
        </p>
      )}
    </div>
  );
}
