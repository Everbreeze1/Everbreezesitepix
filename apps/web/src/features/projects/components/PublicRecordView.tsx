import { useEffect, useState } from "react";
import { Loader2, Lock, Printer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getPublicChecklist,
  getPublicWorkflow,
  type PublicFieldRecord,
} from "@/lib/field-records.functions";
import { RecordDocument } from "./RecordDocument";

/**
 * The shared-link view of a checklist or workflow.
 *
 * One component for both kinds because the payload is one shape and the
 * document renderer is one component — the two routes differ only in which RPC
 * resolves the token.
 *
 * No "Download PDF" button here, deliberately. Reports and documents have
 * server-rendered pdf-lib exports because they are page-composed artefacts whose
 * layout the server owns. A field record is a single flowing sheet, and the
 * browser's own Print → Save as PDF produces it from the same CSS the recipient
 * sees on screen — so there is one layout to keep correct instead of two that
 * can disagree about what was checked.
 */
export function PublicRecordView({
  token,
  kind,
}: {
  token: string;
  kind: "checklist" | "workflow";
}) {
  const [data, setData] = useState<PublicFieldRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const fetcher = kind === "checklist" ? getPublicChecklist : getPublicWorkflow;
        const res = await fetcher({ data: { token } });
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled)
          setData({
            status: "not_found",
            record: null,
            project: null,
            company: null,
            author: null,
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, kind]);

  if (loading) {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data || data.status !== "ok" || !data.record) {
    const noun = kind === "checklist" ? "checklist" : "workflow";
    const msg =
      data?.status === "revoked"
        ? `This ${noun} link has been disabled by the owner.`
        : `This ${noun} link is invalid or no longer available.`;
    return (
      <div className="container mx-auto max-w-xl px-4 py-16">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Lock className="h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {kind === "checklist" ? "Checklist" : "Workflow"} unavailable
          </h1>
          <p className="text-sm text-muted-foreground">{msg}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      <div className="container mx-auto max-w-[850px] px-4 py-8 print:px-0 print:py-0">
        <div className="record-doc-print-hide mb-4 flex justify-end print:hidden">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" />
            Print / Save as PDF
          </Button>
        </div>
        {/* White paper regardless of the visitor's theme — the document owns its
            own palette, so a dark-mode visitor still sees (and prints) a sheet. */}
        <div className="rounded-sm border border-border bg-white p-8 shadow-sm sm:p-12 print:border-none print:p-0 print:shadow-none">
          <RecordDocument
            record={data.record}
            project={data.project}
            company={data.company}
            author={data.author}
            variant="screen"
          />
        </div>
      </div>
    </div>
  );
}
