import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Download, Lock, Printer, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPublicProjectReport, type PublicProjectReport } from "@/lib/project-reports.functions";
import { ReportDocument, type ReportDocModel } from "@/components/ReportDocument";
import { sitepixApi } from "@/lib/sitepix-api";

export const Route = createFileRoute("/share/reports/$token")({
  head: () => ({
    meta: [
      { title: "Shared report — SitePix" },
      { name: "description", content: "A project report shared from SitePix." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicReportPage,
});

function toDocModel(d: PublicProjectReport): ReportDocModel | null {
  if (!d.report) return null;
  return {
    title: d.report.title,
    summary: d.report.summary,
    subtitle: d.report.subtitle,
    createdAt: d.report.created_at,
    photosPerPage: Math.min(4, Math.max(1, d.report.photos_per_page)) as 1 | 2 | 3 | 4,
    cover: {
      enabled: d.report.cover_enabled,
      showProjectName: d.report.cover_show_project_name,
      showAddress: d.report.cover_show_address,
      showDate: d.report.cover_show_date,
      showAuthor: d.report.cover_show_author,
      photos: d.report.cover_photos,
    },
    project: d.project
      ? {
          name: d.project.name,
          street: d.project.street,
          city: d.project.city,
          state: d.project.state,
          zip: d.project.zip,
        }
      : null,
    company: d.company,
    authorName: d.author?.name ?? null,
    sections: d.sections.map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      photos: s.photos.map((p) => ({
        photo_id: p.photo_id,
        image_url: p.image_url,
        caption: p.caption,
      })),
    })),
  };
}

function PublicReportPage() {
  const { token } = Route.useParams();
  const fetchPublic = getPublicProjectReport;
  const [data, setData] = useState<PublicProjectReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchPublic({ data: { token } });
        if (!cancelled) setData(res as PublicProjectReport);
      } catch {
        if (!cancelled) {
          setData({
            status: "not_found",
            report: null,
            project: null,
            company: null,
            author: null,
            sections: [],
            photos: [],
            reviewLinks: [],
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

  if (!data || data.status !== "ok" || !data.report) {
    const msg =
      data?.status === "revoked"
        ? "This report link has been disabled by the owner."
        : "This report link is invalid or no longer available.";
    return (
      <div className="container mx-auto max-w-xl px-4 py-16">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Report unavailable</h1>
          <p className="text-sm text-muted-foreground">{msg}</p>
        </Card>
      </div>
    );
  }

  const doc = toDocModel(data)!;

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      <div className="container mx-auto max-w-[920px] px-4 py-8 print:py-0">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <Button asChild size="sm">
            <a href={sitepixApi.urls.reportPdf(token)} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-4 w-4" /> Download PDF
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        </div>
        <ReportDocument doc={doc} />

        {data.reviewLinks.length > 0 && (
          <Card className="mt-6 flex flex-col items-center gap-3 p-8 text-center print:hidden">
            <Star className="h-8 w-8 fill-primary text-primary" />
            <h2 className="text-lg font-semibold">How did we do?</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              If you're happy with the work, a quick review helps us out a lot.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {data.reviewLinks.map((link, i) => (
                <Button key={i} asChild size="sm">
                  <a href={link.url} target="_blank" rel="noreferrer">
                    Leave a review{link.label ? ` — ${link.label}` : ""}
                  </a>
                </Button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
