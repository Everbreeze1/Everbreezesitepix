import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPublicShowcase, type PublicShowcase } from "@/lib/showcases.functions";

export const Route = createFileRoute("/share/showcases/$token")({
  head: () => ({
    meta: [
      { title: "Showcase — SitePix" },
      { name: "description", content: "A job showcase shared from SitePix." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicShowcasePage,
});

function PublicShowcasePage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<PublicShowcase | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getPublicShowcase({ data: { token } });
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData({ status: "not_found", showcase: null, company: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.showcase) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-20 text-center">
        <ImageOff className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Showcase unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {data?.status === "revoked"
            ? "This showcase has been unpublished."
            : "This link is invalid or no longer available."}
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Back to SitePix</Link>
        </Button>
      </div>
    );
  }

  const s = data.showcase;
  const gridClass =
    s.layout === "masonry"
      ? "columns-1 sm:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid"
      : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="container mx-auto max-w-5xl px-4 py-12 text-center">
          {data.company?.logo_url && (
            <img src={data.company.logo_url} alt="" className="mx-auto mb-4 h-12 w-12 rounded-lg object-cover" />
          )}
          {data.company?.name && (
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{data.company.name}</p>
          )}
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">{s.title}</h1>
          {s.tagline && <p className="mx-auto mt-2 max-w-xl text-muted-foreground">{s.tagline}</p>}
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-4 py-10">
        {s.layout === "featured" && s.items[0] && (
          <div className="mb-4 overflow-hidden rounded-2xl">
            <img src={s.items[0].image_url} alt="" className="h-[420px] w-full object-cover" />
            {s.items[0].caption && (
              <p className="mt-2 text-sm text-muted-foreground">{s.items[0].caption}</p>
            )}
          </div>
        )}
        <div className={gridClass}>
          {(s.layout === "featured" ? s.items.slice(1) : s.items).map((item) => (
            <div key={item.photo_id} className="overflow-hidden rounded-xl border border-border bg-card">
              <img src={item.image_url} alt="" className="w-full object-cover" />
              {item.caption && <p className="p-3 text-sm text-muted-foreground">{item.caption}</p>}
            </div>
          ))}
        </div>
      </div>

      <p className="pb-10 text-center text-xs text-muted-foreground">
        Built with{" "}
        <Link to="/" className="underline-offset-2 hover:underline">
          SitePix
        </Link>
      </p>
    </div>
  );
}
