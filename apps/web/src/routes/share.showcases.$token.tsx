import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPublicShowcase, type PublicShowcase } from "@/lib/showcases.functions";
import { ShowcaseView } from "@/components/ShowcaseView";

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
        if (!cancelled) setData({ status: "not_found", showcase: null, company: null, reviewLinks: [] });
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

  return (
    <ShowcaseView
      showcase={data.showcase}
      company={data.company}
      reviewLinks={data.reviewLinks}
    />
  );
  // Layout lives entirely in <ShowcaseView> so this page and the builder's
  // preview can never drift apart.
}
