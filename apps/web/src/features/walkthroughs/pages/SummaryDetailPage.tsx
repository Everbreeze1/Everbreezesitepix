import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Link2Off,
  Loader2,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { EditableSummaryText } from "@/features/walkthroughs/components/EditableSummaryText";

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
 *
 * Everything on it is edited where it sits: the title, the text and each
 * photo's note save on their own, with no Edit mode and no raw Markdown box.
 * The page uses the full width like the rest of the app.
 */
export function SummaryDetailPage() {
  const { summaryId } = useParams({ from: "/_app/summaries/$summaryId" });
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  /** The title as last saved, so leaving the field unchanged saves nothing. */
  const [savedTitle, setSavedTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [photos, setPhotos] = useState<SummaryPhoto[]>([]);
  const [walkthroughId, setWalkthroughId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  /** A share token is being issued or cleared - both are one round trip. */
  const [minting, setMinting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getWalkthroughSummary({ data: { summaryId } });
      const s = res.summary;
      setTitle(s.title);
      setSavedTitle(s.title);
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

  const saveTitle = async () => {
    const next = title.trim();
    if (!next) {
      setTitle(savedTitle);
      return;
    }
    if (next === savedTitle) return;
    try {
      await updateWalkthroughSummary({ data: { summaryId, title: next } });
      setTitle(next);
      setSavedTitle(next);
      toast.success("Title saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the title");
      setTitle(savedTitle);
    }
  };

  const saveText = async (next: string) => {
    try {
      await updateWalkthroughSummary({ data: { summaryId, markdown: next } });
      setMarkdown(next);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the summary");
      throw e;
    }
  };

  const saveNote = async (photoId: string, note: string) => {
    try {
      await updateWalkthroughSummary({ data: { summaryId, photoNote: { photoId, note } } });
      setPhotos((prev) => prev.map((p) => (p.photoId === photoId ? { ...p, note } : p)));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the note");
      throw e;
    }
  };

  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/summaries/${shareToken}`
    : "";

  /*
   * Open the share panel, minting the link on first use.
   *
   * This button used to copy the URL to the clipboard and say so in a toast,
   * and that was the whole interaction: the link itself was never shown, there
   * was no sign that a summary was already shared, and nothing to click to
   * check what a customer would see. A sender who missed the toast - or whose
   * `navigator.share` sheet was dismissed, or whose browser refused the
   * clipboard write, which Safari does for any write that lands after an
   * `await` - had every reason to fall back to the URL in the address bar, and
   * that URL is `/summaries/<id>`: private, and a sign-in wall for the person
   * it was sent to. The panel below shows the public link and nothing else, so
   * the right one is the one in front of them.
   */
  const onShare = async () => {
    setShareOpen(true);
    if (shareToken || minting) return;
    setMinting(true);
    try {
      const { token } = await setSummaryShare({ data: { summaryId, enable: true } });
      setShareToken(token);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create share link");
      setShareOpen(false);
    } finally {
      setMinting(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Link copied");
    } catch {
      // The clipboard write is refused outside a secure context and, in Safari,
      // once the gesture that started it has expired. The link is on screen, so
      // say to take it by hand rather than failing silently.
      toast.error("Couldn't copy - select the link and copy it");
    }
  };

  /**
   * Turn the link off.
   *
   * `setSummaryShare({ enable: false })` clears the token, so this is not a
   * pause: the URL already sent to a customer stops resolving for good, and
   * sharing again mints a different one. Said plainly in the panel, because the
   * alternative is an owner switching it off to "tidy up" and quietly breaking
   * the link in somebody's inbox.
   */
  const onStopSharing = async () => {
    if (
      !(await confirm({
        title: "Turn off this link?",
        description:
          "The link you have already sent will stop working. Sharing again creates a new one.",
        confirmText: "Turn it off",
        variant: "destructive",
      }))
    )
      return;
    setMinting(true);
    try {
      await setSummaryShare({ data: { summaryId, enable: false } });
      setShareToken(null);
      toast.success("Link turned off");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not turn the link off");
    } finally {
      setMinting(false);
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
    <div className="w-full px-4 pb-24 pt-6 md:px-8 md:pt-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-9">
        <Link to="/projects/$projectId" params={{ projectId }} search={{ panel: "walkthroughs" }}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to {projectName || "project"}
        </Link>
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* The title is a field styled as a heading: click and type, it saves
              when you press Enter or click away. */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(savedTitle);
                e.currentTarget.blur();
              }
            }}
            aria-label="Summary title"
            title="Click to rename"
            className="-mx-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-bold tracking-tight transition hover:border-border focus:border-primary/50 focus:bg-background focus:outline-none md:text-3xl"
          />
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
          <Button size="sm" onClick={() => void onShare()}>
            <Share2 className="mr-1.5 h-3.5 w-3.5" />
            {shareToken ? "Shared" : "Share"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onDelete()}
            aria-label="Delete summary"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </header>

      {/*
        Text first, photos after. The client asked for exactly this reversal,
        and it is only this simple because the photos are no longer embedded in
        the markdown - they are their own array now.
      */}
      <section className="mt-6">
        <h2 className="text-xl font-semibold tracking-tight">Summary</h2>
        <EditableSummaryText
          key={summaryId}
          markdown={markdown}
          onSave={saveText}
          className="mt-3"
        />
      </section>

      <SummaryPhotoNotes photos={photos} timed={!!walkthroughId} onEditNote={saveNote} />

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate">Share “{title}”</DialogTitle>
            <DialogDescription>
              Anyone with this link can read the summary and its photos. They do not need an
              Everlumen account, and they see nothing else on the job.
            </DialogDescription>
          </DialogHeader>

          {minting && !shareToken ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating the link…
            </p>
          ) : shareToken ? (
            <>
              {/* Readable and selectable, not just copyable: a copy that the
                  browser refuses has to leave something to take by hand. */}
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={shareUrl}
                  className="h-9 text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button size="sm" onClick={() => void copyShareLink()}>
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={shareUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Open what they will see
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={minting}
                  onClick={() => void onStopSharing()}
                  className="text-destructive hover:text-destructive"
                >
                  <Link2Off className="mr-1.5 h-3.5 w-3.5" />
                  Turn off this link
                </Button>
              </div>
            </>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              This summary has no link yet. Close this and press Share again to create one.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
