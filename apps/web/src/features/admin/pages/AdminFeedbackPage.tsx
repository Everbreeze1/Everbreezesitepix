import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bug,
  FileText,
  Heart,
  ImageOff,
  Lightbulb,
  Loader2,
  Paperclip,
  Search,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FEEDBACK_STATUSES,
  getFeedbackSummary,
  listFeedback,
  replyToFeedback,
  setFeedbackStatus,
  type FeedbackAttachment,
  type FeedbackReport,
  type FeedbackStatus,
} from "@/lib/admin.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { AdminList } from "../components/AdminTable";
import { useAdminList } from "../hooks/use-admin-list";

const KIND_ICON: Record<string, typeof Bug> = {
  bug: Bug,
  idea: Lightbulb,
  praise: Heart,
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  triaged: "Triaged",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

function statusClass(status: string): string {
  if (status === "new") return "bg-primary/10 text-primary";
  if (status === "triaged") return "bg-amber-500/10 text-amber-600";
  if (status === "resolved") return "bg-emerald-500/10 text-emerald-600";
  return "bg-muted text-muted-foreground";
}

/**
 * The screenshots on a report.
 *
 * The Feedback page has offered "Attach a screenshot" since 20260921000000 and
 * this console rendered nothing for it: the paths arrived on every report,
 * unread, so a report filed with a picture of the bug looked exactly like one
 * filed without. Which made the single most useful thing a reporter can send
 * the one thing triage could not see.
 *
 * Shown inline rather than as a list of links, because the whole point of a
 * screenshot is being able to glance at it while reading the description.
 */
function AttachmentStrip({ attachments }: { attachments: FeedbackAttachment[] }) {
  if (!attachments.length) return null;

  return (
    <div className="mt-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <Paperclip className="h-3 w-3" />
        {attachments.length} {attachments.length === 1 ? "attachment" : "attachments"}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {attachments.map((a) => (
          <AttachmentTile key={a.path} attachment={a} />
        ))}
      </div>
    </div>
  );
}

function AttachmentTile({ attachment }: { attachment: FeedbackAttachment }) {
  const { url, name, kind } = attachment;

  /*
   * A link that could not be signed. The object is missing from storage, or the
   * bucket in 20260921000000 was never created - either way this says which
   * file it was, rather than rendering a broken image and leaving triage to
   * guess whether the reporter attached anything at all.
   */
  if (!url) {
    return (
      <span
        title={attachment.path}
        className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
      >
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{name}</span>
        <span className="shrink-0 opacity-70">unavailable</span>
      </span>
    );
  }

  if (kind === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={`Open ${name}`}
        className="group block overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
      >
        <img
          src={url}
          alt={name}
          loading="lazy"
          // Fixed height, natural width: a screenshot is usually wide and a
          // square crop would cut the part of the screen the report is about.
          className="h-28 w-auto max-w-[18rem] bg-muted object-contain"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`Open ${name}`}
      className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-foreground transition-colors hover:border-primary hover:bg-accent"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </a>
  );
}

function ReportCard({ report, onChanged }: { report: FeedbackReport; onChanged: () => void }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const KindIcon = KIND_ICON[report.kind] ?? Bug;

  const move = async (status: FeedbackStatus) => {
    setBusy(true);
    try {
      await setFeedbackStatus({ data: { reportIds: [report.id], status } });
      toast.success(`Moved to ${STATUS_LABELS[status]}`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update this report");
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    setBusy(true);
    try {
      // Replying is the act of handling it, so it moves the report on by
      // default. Leaving a replied-to report in "New" is how a queue rots.
      await replyToFeedback({
        data: { reportId: report.id, message: message.trim(), status: "resolved" },
      });
      toast.success("Reply sent and marked resolved");
      setMessage("");
      setReplyOpen(false);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send the reply");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-bold capitalize text-foreground">{report.kind}</span>
          {report.sentiment === "good" && <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />}
          {report.sentiment === "bad" && <ThumbsDown className="h-3.5 w-3.5 text-red-600" />}
          {report.feature && (
            <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {report.feature}
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${statusClass(report.status)}`}
        >
          {STATUS_LABELS[report.status as FeedbackStatus] ?? report.status}
        </span>
      </div>

      {report.description ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{report.description}</p>
      ) : (
        // A thumbs signal carries no text. Saying so beats an empty gap that
        // reads as a rendering failure.
        <p className="mt-2 text-sm italic text-muted-foreground">
          No message - this was a one-tap signal.
        </p>
      )}

      <AttachmentStrip attachments={report.attachments ?? []} />

      <p className="mt-2 text-[11px] text-muted-foreground">
        {report.reporter.name ?? report.reporter.email ?? "Signed-out visitor"}
        {report.reporter.email && report.reporter.name ? ` (${report.reporter.email})` : ""} ·{" "}
        {new Date(report.createdAt).toLocaleString()} · via {report.source}
      </p>
      {report.url && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground" title={report.url}>
          On {report.url}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {FEEDBACK_STATUSES.filter((s) => s !== report.status).map((s) => (
          <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => move(s)}>
            {STATUS_LABELS[s]}
          </Button>
        ))}
        {report.reporter.id && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReplyOpen((v) => !v)}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Reply
          </Button>
        )}
      </div>

      {replyOpen && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="This reply arrives in their notifications."
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !message.trim()} onClick={sendReply}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Send reply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminFeedbackPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<FeedbackStatus | "all">("new");
  const [kind, setKind] = useState<"bug" | "idea" | "praise" | "all">("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data: summary } = useQuery({
    queryKey: ["admin", "feedback", "summary"],
    queryFn: () => getFeedbackSummary(),
  });

  const list = useAdminList<
    { reports: FeedbackReport[]; nextCursor: string | null },
    FeedbackReport
  >({
    queryKey: ["admin", "feedback", status, kind, debouncedSearch],
    fetchPage: (cursor) =>
      listFeedback({
        data: {
          status: status === "all" ? undefined : status,
          kind: kind === "all" ? undefined : kind,
          search: debouncedSearch || undefined,
          cursor,
        },
      }),
    rowsOf: (page) => page.reports,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "feedback"] });
  };

  return (
    <div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-extrabold text-foreground">Customer feedback</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Everything submitted from the Feedback page and the in-app prompts.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FEEDBACK_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(status === s ? "all" : s)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                status === s ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
              }`}
            >
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {STATUS_LABELS[s]}
              </p>
              <p className="mt-1 text-2xl font-extrabold text-foreground">
                {summary?.byStatus[s] ?? "-"}
              </p>
            </button>
          ))}
        </div>

        {summary && summary.topFeatures.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Most reported areas
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summary.topFeatures.map((f) => (
                <span
                  key={f.feature}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground"
                >
                  {f.feature}
                  <span className="opacity-70">{f.count}</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Counted over the 1,000 most recent reports.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(["all", "bug", "idea", "praise"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? "default" : "outline"}
              onClick={() => setKind(k)}
              className="capitalize"
            >
              {k === "all" ? "All kinds" : k}
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search message or page…"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-card p-6">
        <AdminList
          count={list.rows.length}
          isPending={list.isPending}
          isFetchingMore={list.isFetchingMore}
          hasMore={list.hasMore}
          onLoadMore={list.loadMore}
          error={list.error}
          emptyMessage={
            status === "new"
              ? "No new feedback. Nothing waiting on you."
              : "No reports match these filters."
          }
        >
          <div className="space-y-3">
            {list.rows.map((r) => (
              <ReportCard key={r.id} report={r} onChanged={refresh} />
            ))}
          </div>
        </AdminList>
      </div>
    </div>
  );
}
