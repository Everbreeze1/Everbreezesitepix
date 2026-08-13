import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ImageOff, MapPin, Calendar, Lock, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPublicProjectShare, type PublicProjectShare } from "@/lib/project-shares.functions";
import { cleanCaption } from "@sitepix/shared";

/**
 * What a scanned QR code opens.
 *
 * No sign-in, no account, no app shell — the person holding the phone is
 * standing at the job site and is not a customer of ours. The payload is built
 * by `getPublicProjectShareService`, which decides what an anonymous visitor is
 * allowed to see; this file only renders it, and deliberately renders no
 * author-controlled HTML at all (see tests/invariants.test.ts).
 */
export const Route = createFileRoute("/share/projects/$token")({
  head: () => ({
    meta: [
      { title: "Shared project — SitePix" },
      { name: "description", content: "A job site shared from SitePix." },
      // A printed QR code is handed to specific people, not published. Keeping
      // it out of search results is the whole difference between "shared" and
      // "public".
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicProjectPage,
});

function formatAddress(p: NonNullable<PublicProjectShare["project"]>): string | null {
  const parts = [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "Mar 3 – Aug 12, 2026", collapsing to one date when the job ran a single day. */
function formatRange(first: string | null, last: string | null): string | null {
  if (!first || !last) return null;
  const a = formatDate(first);
  const b = formatDate(last);
  return a === b ? a : `${a} – ${b}`;
}

function PublicProjectPage() {
  const { token } = Route.useParams();
  const fetchPublic = getPublicProjectShare;
  const [data, setData] = useState<PublicProjectShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<PublicProjectShare["photos"][number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchPublic({ data: { token } });
        if (!cancelled) setData(res as PublicProjectShare);
      } catch {
        if (!cancelled) setData({ status: "not_found", project: null, company: null, photos: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchPublic]);

  // Escape closes the full-size view. A plain overlay rather than the app's
  // Dialog: this page loads for someone with no account, and every component it
  // pulls in is weight on a phone holding one bar of signal at a job site.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (loading) {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.status !== "ok" || !data.project) {
    const msg =
      data?.status === "revoked"
        ? "The owner has turned this link off."
        : "This link is invalid or no longer available.";
    return (
      <div className="container mx-auto px-4 py-16">
        <Card className="mx-auto flex max-w-md flex-col items-center p-8 text-center">
          <Lock className="h-9 w-9 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-semibold">Project unavailable</h1>
          <p className="mt-1 text-sm text-muted-foreground">{msg}</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/">Go to SitePix</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const { project, company, photos } = data;
  const address = formatAddress(project);
  const range = formatRange(project.firstPhotoAt, project.lastPhotoAt);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            SitePix
          </Link>
          {company?.name && (
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {company.logo_url && <img src={company.logo_url} alt="" className="h-5 w-auto" />}
              <span className="truncate">Shared by {company.name}</span>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold sm:text-2xl">{project.name}</h1>
            {address && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {address}
              </p>
            )}
          </div>
          {/*
            `projects.status` is a raw lowercase enum. The app's own header
            renders it "Active"; a page a customer reads should not be the one
            surface that shows them the database value.
          */}
          <Badge variant={project.status === "archived" ? "secondary" : "default"}>
            {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {project.photoCount} photo{project.photoCount === 1 ? "" : "s"}
          </span>
          {range && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {range}
            </span>
          )}
          {/* The API caps one anonymous request; say so rather than quietly
              showing a partial record as if it were the whole job. */}
          {project.photoCount > photos.length && (
            <span>Showing the {photos.length} most recent</span>
          )}
        </div>

        {photos.length === 0 ? (
          <Card className="mt-6 flex flex-col items-center p-10 text-center">
            <ImageOff className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No photos have been added to this project yet.
            </p>
          </Card>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 md:gap-3">
            {photos.map((p) => {
              const caption = cleanCaption(p.caption);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLightbox(p)}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted text-left"
                >
                  <img
                    src={p.thumbUrl}
                    alt={caption ?? "Site photo"}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                  {p.phase && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      {p.phase}
                    </span>
                  )}
                  {caption && (
                    <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-4 text-[11px] leading-tight text-white">
                      {caption}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <footer className="mt-10 space-y-1 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
          {company?.name && (
            <p className="font-medium text-foreground">
              {company.name}
              {company.phone ? ` · ${company.phone}` : ""}
            </p>
          )}
          {company?.address && <p>{company.address}</p>}
          <p>
            Shared via{" "}
            <Link to="/" className="underline-offset-2 hover:underline">
              SitePix
            </Link>
          </p>
        </footer>
      </main>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/15 hover:text-white"
              aria-label="Close photo"
              onClick={() => setLightbox(null)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <img
            src={lightbox.url}
            alt={cleanCaption(lightbox.caption) ?? "Site photo"}
            className="mx-auto min-h-0 flex-1 object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="mt-3 text-center text-xs text-white/80">
            <p>{new Date(lightbox.takenAt).toLocaleString()}</p>
            {(() => {
              const c = cleanCaption(lightbox.caption);
              return c ? <p className="mt-1 text-sm text-white">{c}</p> : null;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
