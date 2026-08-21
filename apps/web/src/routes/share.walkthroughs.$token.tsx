import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ImageOff, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPublicWalkthrough } from "@/lib/walkthroughs.functions";
import {
  cleanWalkthroughMarkdown,
  WalkthroughMarkdown,
  WalkthroughPhotoSteps,
  WalkthroughShareButtons,
  type WalkthroughPhotoStep,
} from "@/components/WalkthroughReport";
import {
  AiNarratedPhotoSteps,
  type WalkthroughNarration,
} from "@/features/walkthroughs/components/WalkthroughNarration";

export const Route = createFileRoute("/share/walkthroughs/$token")({
  head: () => ({
    meta: [
      { title: "Walkthrough Note - SitePix" },
      { name: "description", content: "Shared site walkthrough report." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicWalkthroughPage,
});

interface Data {
  walkthrough: {
    id: string;
    title: string;
    summary_markdown: string | null;
    duration_seconds: number;
    started_at: string;
    status: string;
  } | null;
  project: {
    name: string;
    location: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
  } | null;
  photoUrls: Record<string, string>;
  photoSteps: WalkthroughPhotoStep[];
  /**
   * The AI narration behind the Summary, when the walkthrough has one.
   *
   * The share link is what a client actually opens, so it gets the same
   * per-photo narration the owner sees. Null for a photo-only Summary, for a
   * walkthrough recorded before this feature, and on a database that has not
   * run the narration migration - all three fall back to the older rendering.
   */
  narration: WalkthroughNarration | null;
}

function PublicWalkthroughPage() {
  const { token } = Route.useParams();
  const fetchPublic = getPublicWalkthrough;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchPublic({ data: { token } });
      setData(res as unknown as Data);
    } catch {
      setData({
        walkthrough: null,
        project: null,
        photoUrls: {},
        photoSteps: [],
        narration: null,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchPublic({ data: { token } });
        if (!cancelled) setData(res as unknown as Data);
      } catch {
        if (!cancelled)
          setData({
            walkthrough: null,
            project: null,
            photoUrls: {},
            photoSteps: [],
            narration: null,
          });
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

  if (!data?.walkthrough) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-20 text-center">
        <ImageOff className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Walkthrough unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This share link is invalid, expired, or the report has been unpublished.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Back to SitePix</Link>
        </Button>
      </div>
    );
  }

  const w = data.walkthrough;
  const p = data.project;
  /** No recording behind this one - it is the AI's notes on a set of photos. */
  const isSummary = (w as { source?: string }).source === "summary";
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const addr = p
    ? (p.location ?? ([p.street, p.city, p.state].filter(Boolean).join(", ") || null))
    : null;
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="container mx-auto max-w-3xl px-4 pb-20 pt-6 md:pt-10">
      <Card className="p-6">
        <div className="border-b border-border pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isSummary ? "Photo Summary" : "Walkthrough Note"}
          </p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{w.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {p?.name ? (
                  <>
                    {p.name}
                    {addr ? ` · ${addr}` : ""} ·{" "}
                  </>
                ) : null}
                {new Date(w.started_at).toLocaleDateString()}
                {/* A summary was never recorded, so its duration is 0 - printing
                    "0:00" on a customer-facing page reads as a broken link. */}
                {isSummary ? null : ` · ${fmt(w.duration_seconds)}`}
              </p>
            </div>
            <WalkthroughShareButtons
              url={shareUrl}
              title={w.title}
              copied={copied}
              onCopy={copyShare}
            />
          </div>
        </div>
        <div className="pt-5">
          {w.summary_markdown ? (
            <>
              {!isSummary && data.narration ? (
                <AiNarratedPhotoSteps steps={data.photoSteps ?? []} narration={data.narration} />
              ) : (
                <WalkthroughPhotoSteps
                  steps={data.photoSteps ?? []}
                  variant={isSummary ? "summary" : "recorded"}
                />
              )}
              <WalkthroughMarkdown
                markdown={cleanWalkthroughMarkdown(w.summary_markdown)}
                photoUrls={data.photoUrls}
                variant={isSummary ? "summary" : "recorded"}
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isSummary ? "Summary" : "Report"} is still being generated. Refresh in a moment.
              </p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          )}
        </div>
      </Card>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Created with{" "}
        <Link to="/" className="underline-offset-2 hover:underline">
          SitePix
        </Link>
      </p>
    </div>
  );
}
