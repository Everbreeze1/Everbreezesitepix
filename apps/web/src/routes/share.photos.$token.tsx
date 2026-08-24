import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ImageOff, Download, MapPin, Calendar, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPublicPhotoShare, type PublicPhotoShare } from "@/lib/photo-shares.functions";
import { cleanCaption } from "@everlumen/shared";

export const Route = createFileRoute("/share/photos/$token")({
  head: () => ({
    meta: [
      { title: "Shared photo - Everlumen" },
      { name: "description", content: "A photo shared from a Everlumen project." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicPhotoPage,
});

function formatAddress(p: PublicPhotoShare["project"]): string | null {
  if (!p) return null;
  const parts = [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function PublicPhotoPage() {
  const { token } = Route.useParams();
  const fetchPublic = getPublicPhotoShare;
  const [data, setData] = useState<PublicPhotoShare | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchPublic({ data: { token } });
        if (!cancelled) setData(res as PublicPhotoShare);
      } catch {
        if (!cancelled) {
          setData({
            status: "not_found",
            photo: null,
            project: null,
            company: null,
            allowDownload: false,
            expiresAt: null,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchPublic]);

  if (loading) {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.status !== "ok" || !data.photo) {
    const msg =
      data?.status === "expired"
        ? "This link has expired."
        : data?.status === "revoked"
          ? "This link has been revoked by the owner."
          : "This link is invalid or no longer available.";
    return (
      <div className="container mx-auto px-4 py-16">
        <Card className="mx-auto flex max-w-md flex-col items-center p-8 text-center">
          <Lock className="h-9 w-9 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">Photo unavailable</h1>
          <p className="mt-1 text-sm text-muted-foreground">{msg}</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/">Go to Everlumen</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const { photo, project, company, allowDownload, expiresAt } = data;
  const address = formatAddress(project);
  const phaseLabel = photo.phase === "before" ? "BEFORE" : photo.phase === "after" ? "AFTER" : null;
  const takenAt = photo.taken_at ?? photo.created_at;

  const handleDownload = async () => {
    try {
      const resp = await fetch(photo.image_url);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `everlumen-${photo.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(photo.image_url, "_blank", "noopener");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            Everlumen
          </Link>
          {company?.name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {company.logo_url && <img src={company.logo_url} alt="" className="h-5 w-auto" />}
              <span>Shared by {company.name}</span>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-6">
        <div className="overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
          {photo.image_url ? (
            <img
              src={photo.image_url}
              alt={cleanCaption(photo.caption) ?? "Shared photo"}
              className="block max-h-[80vh] w-full object-contain"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-muted-foreground">
              <ImageOff className="h-8 w-8" />
            </div>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {phaseLabel && (
              <Badge variant={photo.phase === "after" ? "default" : "secondary"}>
                {phaseLabel}
              </Badge>
            )}
            {photo.tags?.map((t) => (
              <Badge key={t} variant="outline">
                #{t}
              </Badge>
            ))}
          </div>

          {project && (
            <div>
              <h1 className="text-lg font-semibold">{project.name}</h1>
              {address && (
                <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {address}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(takenAt).toLocaleString()}
            </span>
            {photo.latitude != null && photo.longitude != null && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {photo.latitude.toFixed(5)}, {photo.longitude.toFixed(5)}
              </span>
            )}
            {expiresAt && <span>Link expires {new Date(expiresAt).toLocaleString()}</span>}
          </div>

          {(() => {
            const c = cleanCaption(photo.caption);
            return c ? (
              <p className="rounded-lg border border-border bg-card p-3 text-sm">{c}</p>
            ) : null;
          })()}

          {allowDownload && photo.image_url && (
            <div className="pt-2">
              <Button onClick={handleDownload} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Download original
              </Button>
            </div>
          )}
        </div>

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Shared via{" "}
          <Link to="/" className="underline-offset-2 hover:underline">
            Everlumen
          </Link>
        </p>
      </main>
    </div>
  );
}
