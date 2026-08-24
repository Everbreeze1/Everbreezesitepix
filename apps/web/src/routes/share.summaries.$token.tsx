import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getPublicSummary, type SummaryPhoto } from "@/lib/summaries.functions";
import { SummaryPhotoNotes } from "@/features/walkthroughs/components/SummaryPhotoNotes";

export const Route = createFileRoute("/share/summaries/$token")({
  head: () => ({
    meta: [
      { title: "Summary - Everlumen" },
      { name: "description", content: "Shared site summary." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicSummaryPage,
});

interface Data {
  summary: {
    id: string;
    title: string;
    markdown: string | null;
    createdAt: string;
    photoCount: number;
    hasSpeech: boolean;
  } | null;
  project: {
    name: string;
    location: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
  } | null;
  photos: SummaryPhoto[];
}

const EMPTY: Data = { summary: null, project: null, photos: [] };

/**
 * A summary, shared with somebody who has the link and no account.
 *
 * Its own route, so the summary can be sent to a client without also handing
 * over the recording: "the video can be shared and the summary can be generated
 * and shared" as two separate acts.
 */
function PublicSummaryPage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getPublicSummary({ data: { token } });
        if (!cancelled) setData(res as unknown as Data);
      } catch {
        if (!cancelled) setData(EMPTY);
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
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = data?.summary;
  if (!s) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="text-xl font-semibold">This summary is not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may have been turned off, or the job it belongs to may have been removed.
        </p>
      </div>
    );
  }

  const p = data?.project;
  const address = p ? (p.location ?? [p.street, p.city, p.state].filter(Boolean).join(", ")) : "";

  return (
    <div className="container mx-auto max-w-3xl px-4 pb-20 pt-6 md:pt-10">
      <Card className="p-6">
        <div className="border-b border-border pb-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            AI Summary
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{s.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {p?.name ? (
              <>
                {p.name}
                {address ? ` · ${address}` : ""} ·{" "}
              </>
            ) : null}
            {new Date(s.createdAt).toLocaleDateString()}
          </p>
        </div>

        {/* Text first, photos after - the same order the owner sees. */}
        <div className="pt-5">
          <div className="wt-markdown rounded-xl border border-border bg-muted/20 p-5">
            <ReactMarkdown>{s.markdown || "_No summary text._"}</ReactMarkdown>
          </div>
          <SummaryPhotoNotes photos={data?.photos ?? []} timed={s.hasSpeech} />
        </div>
      </Card>
    </div>
  );
}
