import { useMemo, useState } from "react";
import { Check, Copy, Images, Loader2, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/hooks/use-confirm";
import { cn } from "@/lib/utils";
import { rotatePortfolioEmbedKey, type PortfolioDetail } from "@/lib/portfolio.functions";

/**
 * "Add it to your own website" — the third of CompanyCam's three ways to use a
 * portfolio, and the one that keeps working after a prospect leaves this site.
 *
 * The whole design goal is that the contractor never sees a decision they can
 * get wrong: pick a couple of options, press Copy, paste one line. Everything
 * else (sizing, responsiveness, the iframe itself) is handled by /embed.js.
 */
export function PortfolioEmbedsPanel({
  portfolio,
  onEmbedKeyChanged,
}: {
  portfolio: PortfolioDetail;
  onEmbedKeyChanged: (key: string) => void;
}) {
  const confirm = useConfirm();
  const [rotating, setRotating] = useState(false);

  const [columns, setColumns] = useState<"2" | "3" | "4">("3");
  const [showFilters, setShowFilters] = useState(true);
  const [limit, setLimit] = useState<"12" | "24" | "60">("24");
  const [mapHeight, setMapHeight] = useState<"360" | "460" | "600">("460");
  const [usePinColor, setUsePinColor] = useState(true);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const gallerySnippet = useMemo(
    () =>
      [
        `<script async src="${origin}/embed.js"`,
        `  data-sitepix="gallery"`,
        `  data-key="${portfolio.embed_key}"`,
        `  data-columns="${columns}"`,
        `  data-limit="${limit}"`,
        ...(showFilters ? [] : [`  data-filters="0"`]),
        `></script>`,
      ].join("\n"),
    [origin, portfolio.embed_key, columns, limit, showFilters],
  );

  const mapSnippet = useMemo(
    () =>
      [
        `<script async src="${origin}/embed.js"`,
        `  data-sitepix="map"`,
        `  data-key="${portfolio.embed_key}"`,
        `  data-height="${mapHeight}"`,
        ...(usePinColor && portfolio.accent_color
          ? [`  data-pin="${portfolio.accent_color}"`]
          : []),
        `></script>`,
      ].join("\n"),
    [origin, portfolio.embed_key, mapHeight, usePinColor, portfolio.accent_color],
  );

  const rotate = async () => {
    const ok = await confirm({
      title: "Rotate the embed key?",
      description:
        "Any gallery or map you've already installed on another website will stop working until you paste the new snippet. Your portfolio address is not affected.",
      confirmText: "Rotate key",
      cancelText: "Cancel",
      variant: "destructive",
    });
    if (!ok) return;
    setRotating(true);
    try {
      const res = await rotatePortfolioEmbedKey();
      onEmbedKeyChanged(res.embedKey);
      toast.success("Embed key rotated — paste the new snippets on your site.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not rotate the key");
    } finally {
      setRotating(false);
    }
  };

  if (!portfolio.published) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <Images className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-bold text-foreground">Publish your site first</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Embeds read from the same published work as your portfolio site, so they stay empty until
          it's live.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <EmbedCard
          icon={Images}
          title="Website gallery"
          description="A scrollable grid of your projects, filterable by service. Best on a “Our work” or “Gallery” page."
          snippet={gallerySnippet}
          previewSrc={`${origin}/embed/gallery/${portfolio.embed_key}?columns=${columns}&limit=${limit}${showFilters ? "" : "&filters=0"}`}
          previewHeight={520}
          options={
            <>
              <Field label="Columns">
                <Select value={columns} onValueChange={(v) => setColumns(v as typeof columns)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 across</SelectItem>
                    <SelectItem value="3">3 across</SelectItem>
                    <SelectItem value="4">4 across</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Show at most">
                <Select value={limit} onValueChange={(v) => setLimit(v as typeof limit)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12 projects</SelectItem>
                    <SelectItem value="24">24 projects</SelectItem>
                    <SelectItem value="60">60 projects</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <ToggleRow
                label="Service filters"
                hint="Turn off in narrow sidebars where the chips wrap badly."
                checked={showFilters}
                onChange={setShowFilters}
              />
            </>
          }
        />

        <EmbedCard
          icon={MapPin}
          title="Website map"
          description="An interactive map of every job you've completed. Best on a “Service areas” or “Contact” page."
          snippet={mapSnippet}
          previewSrc={`${origin}/embed/map/${portfolio.embed_key}?height=${mapHeight}${usePinColor && portfolio.accent_color ? `&pin=${encodeURIComponent(portfolio.accent_color)}` : ""}`}
          previewHeight={Number(mapHeight) + 20}
          options={
            <>
              <Field label="Height">
                <Select
                  value={mapHeight}
                  onValueChange={(v) => setMapHeight(v as typeof mapHeight)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="360">Short (360px)</SelectItem>
                    <SelectItem value="460">Medium (460px)</SelectItem>
                    <SelectItem value="600">Tall (600px)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <ToggleRow
                label="Brand-coloured pins"
                hint={`Uses ${portfolio.accent_color ?? "your brand colour"} instead of the default blue.`}
                checked={usePinColor}
                onChange={setUsePinColor}
              />
            </>
          }
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">How to install</p>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>
            <span className="font-bold text-foreground">1.</span> Copy the snippet above.
          </li>
          <li>
            <span className="font-bold text-foreground">2.</span> In your website builder, add an
            “Embed”, “Custom HTML” or “Code” block where you want it to appear.
          </li>
          <li>
            <span className="font-bold text-foreground">3.</span> Paste and publish. It resizes
            itself and updates automatically whenever you add a project.
          </li>
        </ol>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Embed key</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Rotate this if a snippet ends up somewhere it shouldn't. Your site address stays the
              same.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={rotate} disabled={rotating}>
            {rotating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Rotate key
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmbedCard({
  icon: Icon,
  title,
  description,
  snippet,
  previewSrc,
  previewHeight,
  options,
}: {
  icon: typeof Images;
  title: string;
  description: string;
  snippet: string;
  previewSrc: string;
  previewHeight: number;
  options: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Snippet copied");
    } catch {
      toast.error("Could not copy — select the snippet and copy it manually.");
    }
  };

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">{options}</div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <Label className="mb-0">Paste this into your website</Label>
          <Button size="sm" variant={copied ? "secondary" : "default"} onClick={copy}>
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-foreground">
          <code>{snippet}</code>
        </pre>
      </div>

      {/* Live preview of the real embed route — what they see here is literally
          what the iframe will render on their site, not a mock. */}
      <div className="mt-5 flex-1">
        <Label>Preview</Label>
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <iframe
            src={previewSrc}
            title={`${title} preview`}
            className="w-full"
            style={{ height: previewHeight }}
          />
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 rounded-lg border border-border p-3")}
    >
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
