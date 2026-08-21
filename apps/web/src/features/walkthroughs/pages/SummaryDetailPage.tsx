import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Loader2,
  Save,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import {
  deleteWalkthroughSummary,
  getWalkthroughSummary,
  setSummaryShare,
  updateWalkthroughSummary,
  type SummaryPhoto,
} from "@/lib/summaries.functions";
import { SummaryPhotoNotes } from "@/features/walkthroughs/components/SummaryPhotoNotes";

/**
 * A walkthrough Summary, on its own route.
 *
 * The client's first point: "opening an 'AI Summary' from Reports loads at a
 * /walkthroughs/{id} URL with the tab title 'Walkthrough,' even when there's no
 * video." This page is at `/summaries/{id}`, titled "Summary", and knows
 * nothing about video playback - because a summary is not a recording, and the
 * only reason it ever pretended to be was that both were rows in one table.
 *
 * The order is the client's too: "the text is on the bottom and the pictures
 * are on top, it should be backward. Please make that text show first for
 * summary and the pictures after." Written summary, then the photos, each with
 * its own note.
 */
export function SummaryDetailPage() {
  const { summaryId } = useParams({ from: "/_app/summaries/$summaryId" });
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [photos, setPhotos] = useState<SummaryPhoto[]>([]);
  const [walkthroughId, setWalkthroughId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getWalkthroughSummary({ data: { summaryId } });
      const s = res.summary;
      setTitle(s.title);
      setMarkdown(s.markdown ?? "");
      setWalkthroughId(s.walkthroughId);
      setProjectId(s.projectId);
      setProjectName(res.projectName ?? "");
      setShareToken(s.shareToken);
      setCreatedAt(s.createdAt);
      setPhotos(res.photos as SummaryPhoto[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Summary not found");
      navigate({ to: "/projects" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [summaryId]);

  const save = async () => {
    setSaving(true);
    try {
      await updateWalkthroughSummary({ data: { summaryId, title, markdown } });
      toast.success("Saved");
      setEditing(false);
      void load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/summaries/${shareToken}`
    : "";

  /** Issue the link on first use, then hand it over however the device can. */
  const onShare = async () => {
    let url = shareUrl;
    if (!shareToken) {
      try {
        const { token } = await setSummaryShare({ data: { summaryId, enable: true } });
        setShareToken(token);
        url = `${window.location.origin}/share/summaries/${token}`;
      } catch (e: any) {
        toast.error(e?.message ?? "Could not create share link");
        return;
      }
    }
    const canNativeShare =
      typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (canNativeShare) {
      try {
        await navigator.share({ title, text: title, url });
        return;
      } catch {
        // Cancelled - fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        // The photos belong to the project, not to the summary, and saying so
        // plainly is the difference between "delete this write-up" and "delete
        // my site photos".
        description: "Delete this summary? Your photos and the recording are not affected.",
        variant: "destructive",
      }))
    )
      return;
    try {
      await deleteWalkthroughSummary({ data: { summaryId } });
      toast.success("Summary deleted");
      navigate({
        to: "/projects/$projectId",
        params: { projectId },
        search: { panel: "walkthroughs" },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete");
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-9">
        <Link to="/projects/$projectId" params={{ projectId }} search={{ panel: "walkthroughs" }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to {projectName || "project"}
        </Link>
      </Button>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg font-semibold"
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                <Sparkles className="h-3 w-3" />
                AI Summary
              </span>
              <span>
                {photos.length} {photos.length === 1 ? "photo" : "photos"}
              </span>
              {createdAt && <span>{new Date(createdAt).toLocaleString()}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => void onShare()}>
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Share2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Share"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onDelete()}
                  aria-label="Delete summary"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* The recording this was written from, when there is one. A link, not
            an embedded player: the video is its own artefact with its own page
            and its own share link, which is the separation asked for. */}
        {walkthroughId && (
          <Button asChild size="sm" variant="secondary" className="mt-4 h-8 rounded-lg text-xs">
            <Link to="/walkthroughs/$walkthroughId" params={{ walkthroughId }}>
              <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
              Watch the walkthrough this came from
            </Link>
          </Button>
        )}
      </Card>

      <Card className="mt-4 p-5">
        {editing ? (
          <Textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={20}
            className="font-mono text-sm leading-relaxed"
            placeholder="Summary markdown…"
          />
        ) : (
          <>
            {/*
              Text first, photos after. The client asked for exactly this
              reversal, and it is only this simple because the photos are no
              longer embedded in the markdown - they are their own array now.
            */}
            <section>
              <h2 className="text-xl font-semibold tracking-tight">Summary</h2>
              <div className="wt-markdown mt-3 rounded-xl border border-border bg-muted/20 p-5">
                <ReactMarkdown>{markdown || "_No summary text._"}</ReactMarkdown>
              </div>
            </section>

            <SummaryPhotoNotes photos={photos} timed={!!walkthroughId} />
          </>
        )}
      </Card>
    </div>
  );
}
