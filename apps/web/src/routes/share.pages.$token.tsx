import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Download, Lock, Printer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getPublicProjectPage,
  getPublicProjectPagePdf,
  type PublicProjectPage,
} from "@/lib/project-pages.functions";
import { downloadBase64File } from "@/lib/download-file";

export const Route = createFileRoute("/share/pages/$token")({
  head: () => ({
    meta: [
      { title: "Shared document - SitePix" },
      { name: "description", content: "A document shared from SitePix." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicPagePage,
});

function PublicPagePage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<PublicProjectPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getPublicProjectPage({ data: { token } });
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData({ status: "not_found", page: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await getPublicProjectPagePdf({ data: { token } });
      downloadBase64File(res.pdfBase64, res.filename);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.status !== "ok" || !data.page) {
    const msg =
      data?.status === "revoked"
        ? "This document link has been disabled by the owner."
        : "This document link is invalid or no longer available.";
    return (
      <div className="container mx-auto max-w-xl px-4 py-16">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Document unavailable</h1>
          <p className="text-sm text-muted-foreground">{msg}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      <div className="container mx-auto max-w-[850px] px-4 py-8 print:py-0">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <Button size="sm" onClick={handleDownload} disabled={downloading}>
            {downloading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        </div>
        <div className="rounded-sm border border-border bg-card p-10 shadow-sm sm:p-14 print:border-none print:shadow-none">
          {data.page.headerHtml && (
            <div
              className="tiptap prose prose-sm mb-4 max-w-none border-b border-dashed border-border pb-3 text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: data.page.headerHtml }}
            />
          )}
          <h1 className="font-display mb-6 text-3xl font-bold text-foreground">{data.page.title}</h1>
          <div
            className="tiptap prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: data.page.contentHtml }}
          />
          {data.page.footerHtml && (
            <div
              className="tiptap prose prose-sm mt-6 max-w-none border-t border-dashed border-border pt-3 text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: data.page.footerHtml }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
