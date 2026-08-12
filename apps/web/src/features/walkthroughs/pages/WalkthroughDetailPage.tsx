import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Save,
  Share2,
  Trash2,
  RefreshCw,
  Sparkles,
  Clock,
  Images,
  ImageOff,
  Check,
  Copy,
  MoreVertical,
  PlayCircle,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/sitepix/client";
import { sitepixApi } from "@/lib/sitepix-api";
import { devLog } from "@/lib/dev-log";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { useSubscription } from "@/hooks/use-subscription";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import {
  generateWalkthroughReport,
  regenerateWalkthroughSummary,
  setWalkthroughShare,
  updateWalkthroughVideoPath,
} from "@/features/walkthroughs/api";
import { toast } from "sonner";
import {
  cleanWalkthroughMarkdown,
  estimateWalkthroughNote,
  WalkthroughMarkdown,
  WalkthroughPhotoSteps,
  type WalkthroughPhotoStep,
} from "@/components/WalkthroughReport";
import { VideoPlayerDialog } from "@/features/photos/components/VideoPlayerDialog";
import { VideoThumbnail } from "@/features/photos/components/VideoThumbnail";

interface Walkthrough {
  id: string;
  project_id: string;
  title: string;
  status: string;
  /** 'recorded' | 'summary' — see 20260814000000_walkthrough_source.sql. */
  source: string;
  started_at: string;
  duration_seconds: number;
  transcript: string | null;
  summary_markdown: string | null;
  share_token: string | null;
  video_path: string | null;
  video_mime_type: string | null;
}

export function WalkthroughDetailPage() {
  const { walkthroughId } = useParams({ from: "/_app/walkthroughs/$walkthroughId" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const {
    canUseAutoReports,
    autoReportsUsed,
    autoReportsLimit,
    autoReportsRemaining,
    bumpAutoReportsUsed,
  } = useSubscription();
  const [autoReportUpgradeOpen, setAutoReportUpgradeOpen] = useState(false);
  const [walk, setWalk] = useState<Walkthrough | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoSteps, setPhotoSteps] = useState<WalkthroughPhotoStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);

  const regenerate = generateWalkthroughReport;
  const setShare = setWalkthroughShare;
  const updateWalkVideo = updateWalkthroughVideoPath;

  const load = async () => {
    setLoading(true);
    const { data: w } = await supabase
      .from("walkthroughs" as any)
      .select(
        "id, project_id, title, status, source, started_at, duration_seconds, transcript, summary_markdown, share_token, video_path, video_mime_type",
      )
      .eq("id", walkthroughId)
      .maybeSingle();
    if (!w) {
      toast.error("Walkthrough not found");
      navigate({ to: "/projects" });
      return;
    }
    setTitle((w as any).title);
    setMarkdown((w as any).summary_markdown ?? "");

    const { data: proj } = await supabase
      .from("projects")
      .select("name")
      .eq("id", (w as any).project_id)
      .maybeSingle();
    setProjectName((proj as any)?.name ?? "");

    // Sign the recorded video URL (if present) for inline playback.
    let vPath = (w as any).video_path as string | null;
    let vMime = (w as any).video_mime_type as string | null;
    // A summary has no recording, so the storage sweep below can only ever come
    // back empty — skip it rather than issue a doomed list() on every load.
    if (!vPath && user?.id && (w as any).source !== "summary") {
      const prefix = `${user.id}/${(w as any).project_id}/walkthroughs`;
      const { data: objects, error: listErr } = await supabase.storage
        .from("site-videos")
        .list(prefix, { limit: 20, search: walkthroughId });
      if (listErr) {
        console.warn("[walkthrough] detail stored video lookup failed", listErr, {
          wid: walkthroughId,
          prefix,
        });
      } else {
        const object = (objects ?? []).find(
          (item) =>
            item.name === `${walkthroughId}.webm` ||
            item.name === `${walkthroughId}.mp4` ||
            item.name.startsWith(`${walkthroughId}.`),
        );
        if (object) {
          vPath = `${prefix}/${object.name}`;
          vMime = object.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/webm";
          devLog("[walkthrough] detail recovered video path from storage", {
            wid: walkthroughId,
            path: vPath,
            mime: vMime,
          });
          try {
            await updateWalkVideo({
              data: { walkthroughId, videoPath: vPath, videoMimeType: vMime },
            });
          } catch (updateErr) {
            console.warn("[walkthrough] detail recovered video path DB update failed", updateErr, {
              wid: walkthroughId,
              path: vPath,
            });
          }
        }
      }
    }
    if (vPath) {
      const { data: vSigned } = await supabase.storage
        .from("site-videos")
        .createSignedUrl(vPath, 60 * 60);
      setVideoUrl(vSigned?.signedUrl ?? null);
    } else {
      setVideoUrl(null);
    }
    setWalk({ ...(w as any), video_path: vPath, video_mime_type: vMime });

    const { data: links } = await supabase
      .from("walkthrough_photos" as any)
      .select("photo_id, offset_seconds, spoken_note, position")
      .eq("walkthrough_id", walkthroughId)
      .order("position", { ascending: true });
    const linkRows = (links as any[]) ?? [];
    const ids = Array.from(new Set(linkRows.map((l) => l.photo_id).filter(Boolean)));
    if (ids.length) {
      const { data: phRows } = await supabase
        .from("photos")
        .select("id, storage_path, image_url, caption, taken_at")
        .in("id", ids);
      const rows = (phRows as any[]) ?? [];
      const toSign = rows.filter((r) => !r.image_url && r.storage_path).map((r) => r.storage_path);
      const signed: Record<string, string> = {};
      if (toSign.length) {
        const { data: s } = await supabase.storage
          .from("site-photos")
          .createSignedUrls(toSign, 60 * 60);
        (s ?? []).forEach((u, i) => {
          if (u.signedUrl) signed[toSign[i]] = u.signedUrl;
        });
      }
      const map: Record<string, string> = {};
      const meta = new Map<
        string,
        { caption: string | null; taken_at: string | null; image_url: string }
      >();
      rows.forEach((r) => {
        const imageUrl = r.image_url ?? signed[r.storage_path] ?? "";
        map[r.id] = imageUrl;
        meta.set(r.id, {
          caption: r.caption ?? null,
          taken_at: r.taken_at ?? null,
          image_url: imageUrl,
        });
      });
      setPhotoUrls(map);
      setPhotoSteps(
        linkRows.map((l, i) => {
          const p = meta.get(l.photo_id);
          const note = l.spoken_note?.trim()
            ? l.spoken_note
            : estimateWalkthroughNote(
                (w as any).transcript,
                l.offset_seconds ?? 0,
                linkRows[i + 1]?.offset_seconds ?? null,
                (w as any).duration_seconds ?? 0,
                i,
                linkRows.length,
              );
          return {
            photo_id: l.photo_id,
            offset_seconds: l.offset_seconds ?? 0,
            spoken_note: note,
            position: l.position ?? 0,
            caption: p?.caption ?? null,
            taken_at: p?.taken_at ?? null,
            image_url: p?.image_url ?? "",
          };
        }),
      );
    } else {
      setPhotoUrls({});
      setPhotoSteps([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [walkthroughId, user?.id]);

  // While the background pipeline is still working (transcription → report),
  // poll the row so the page flips to the finished report automatically
  // without the user needing to refresh.
  useEffect(() => {
    // A summary is written `ready` in one shot — there is no background
    // pipeline behind it, so there is nothing to poll for.
    if (!walk || walk.source === "summary" || walk.status === "ready" || walk.status === "failed")
      return;
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk?.status]);

  const save = async () => {
    if (!walk) return;
    setSaving(true);
    const { error } = await supabase
      .from("walkthroughs" as any)
      .update({ title, summary_markdown: markdown })
      .eq("id", walk.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    setEditing(false);
    void load();
  };

  const onRegenerate = async () => {
    if (!walk) return;
    /*
     * A summary redraws from its linked photos and spends no Auto Report quota,
     * so it must not pass through the quota gate below — that gate would show a
     * Pro paywall to a Starter user for regenerating something they own and
     * created on their current plan.
     */
    if (walk.source === "summary") {
      setRegenerating(true);
      try {
        const { markdown: md, aiFailed } = await regenerateWalkthroughSummary({
          data: { walkthroughId: walk.id },
        });
        setMarkdown(md);
        if (aiFailed) toast.warning("Rebuilt without AI text", { description: aiFailed });
        else toast.success("Summary regenerated");
        void load();
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to regenerate");
      } finally {
        setRegenerating(false);
      }
      return;
    }
    // Client-side check is only for a fast, friendly upgrade prompt — the
    // server (assertAutoReportAllowed) is the actual enforcing authority.
    if (!canUseAutoReports || autoReportsRemaining <= 0) {
      setAutoReportUpgradeOpen(true);
      return;
    }
    setRegenerating(true);
    try {
      const { markdown: md } = await regenerate({ data: { walkthroughId: walk.id } });
      setMarkdown(md);
      bumpAutoReportsUsed();
      toast.success("Report regenerated");
      void load();
    } catch (e: any) {
      if (/Auto Reports/i.test(e?.message ?? "")) setAutoReportUpgradeOpen(true);
      else toast.error(e?.message ?? "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  };

  const onToggleShare = async (enable: boolean) => {
    if (!walk) return;
    try {
      const { token } = await setShare({ data: { walkthroughId: walk.id, enable } });
      setWalk({ ...walk, share_token: token });
      toast.success(enable ? "Share link enabled" : "Share link disabled");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  const shareUrl = walk?.share_token
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/walkthroughs/${walk.share_token}`
    : "";

  const copyShare = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onDelete = async () => {
    if (!walk) return;
    if (
      !(await confirm({
        // The linked photos are the user's own gallery photos, so say plainly
        // that deleting a summary does not touch them — otherwise "cannot be
        // undone" reads as though the photos go too.
        description: isSummary
          ? "Delete this summary? Your photos are not affected. This cannot be undone."
          : "Delete this walkthrough? This cannot be undone.",
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from("walkthroughs" as any)
      .delete()
      .eq("id", walk.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isSummary ? "Summary deleted" : "Walkthrough deleted");
    navigate({
      to: "/projects/$projectId",
      params: { projectId: walk.project_id },
      search: { panel: "walkthroughs" },
    });
  };

  const renderedMarkdown = useMemo(() => cleanWalkthroughMarkdown(markdown), [markdown]);

  if (loading || !walk) {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  /** No recording behind this row: no video, no narration, no duration. */
  const isSummary = walk.source === "summary";

  const displayTitle = (() => {
    const t = (walk.title ?? "").trim();
    const generic = /^walkthrough\s*[—-]/i.test(t) || /^walkthrough$/i.test(t);
    if (t && !generic) return t;
    const date = new Date(walk.started_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return projectName ? `${projectName} — ${date}` : `Walkthrough — ${date}`;
  })();

  const canNativeShare =
    typeof navigator !== "undefined" && typeof (navigator as any).share === "function";

  const onShare = async () => {
    // Ensure a public share link exists, then open native share / copy fallback.
    let url = shareUrl;
    if (!walk.share_token) {
      try {
        const { token } = await setShare({ data: { walkthroughId: walk.id, enable: true } });
        setWalk({ ...walk, share_token: token });
        url = `${window.location.origin}/share/walkthroughs/${token}`;
      } catch (e: any) {
        toast.error(e?.message ?? "Could not create share link");
        return;
      }
    }
    if (canNativeShare) {
      try {
        await (navigator as any).share({ title: displayTitle, text: displayTitle, url });
        return;
      } catch {
        // User cancelled — fall through to copy.
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

  const onDownloadPdf = async () => {
    if (!walk) return;
    let token = walk.share_token;
    if (!token) {
      try {
        const { token: newToken } = await setShare({
          data: { walkthroughId: walk.id, enable: true },
        });
        token = newToken;
        setWalk({ ...walk, share_token: newToken });
      } catch (e: any) {
        toast.error(e?.message ?? "Could not prepare PDF link");
        return;
      }
    }
    if (typeof window !== "undefined") {
      window.open(sitepixApi.urls.walkthroughPdf(token!), "_blank", "noopener,noreferrer");
    }
  };

  // pt-only responsive scaling — `md:py-10` outranked the `pb-24` and made it
  // dead at >=768px. Harmless here (the camera button is hidden on
  // /walkthroughs/), but the class should mean what it says.
  return (
    <div className="container mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-9">
        <Link
          to="/projects/$projectId"
          params={{ projectId: walk.project_id }}
          search={{ panel: "walkthroughs" }}
        >
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
              <h1 className="text-2xl font-bold tracking-tight">{displayTitle}</h1>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {isSummary ? (
                <span className="inline-flex items-center gap-1">
                  <Images className="h-3 w-3" />
                  {photoSteps.length} {photoSteps.length === 1 ? "photo" : "photos"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {fmt(walk.duration_seconds)}
                </span>
              )}
              <span>{new Date(walk.started_at).toLocaleString()}</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary capitalize">
                {isSummary ? "AI summary" : walk.status}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setTitle(walk.title);
                    setMarkdown(walk.summary_markdown ?? "");
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
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
                <Button size="sm" onClick={onShare} disabled={!walk.summary_markdown}>
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Share2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Share
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onDownloadPdf()}
                  disabled={!walk.summary_markdown}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  PDF
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" aria-label="More options">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <Save className="mr-2 h-3.5 w-3.5" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void onRegenerate()} disabled={regenerating}>
                      <Sparkles className="mr-2 h-3.5 w-3.5" />
                      {regenerating
                        ? "Regenerating\u2026"
                        : isSummary
                          ? "Regenerate summary"
                          : "Regenerate report"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => void onDelete()}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </Card>

      {!isSummary && videoUrl && (
        <Card className="mt-4 overflow-hidden p-0">
          <VideoThumbnail
            cacheKey={`walk-detail:${walk.id}`}
            videoUrl={videoUrl}
            onClick={() => {
              devLog("[walkthrough] detail video thumbnail clicked", {
                wid: walk.id,
                hasVideoUrl: !!videoUrl,
              });
              setVideoOpen(true);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
            <p className="text-sm font-medium">Walkthrough video</p>
            <Button size="sm" onClick={() => setVideoOpen(true)}>
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
              Play video
            </Button>
          </div>
        </Card>
      )}

      {!isSummary && (
        <VideoPlayerDialog
          open={videoOpen}
          onClose={() => setVideoOpen(false)}
          videoUrl={videoUrl}
          title={displayTitle}
          mimeType={walk.video_mime_type}
        />
      )}

      {walk.summary_markdown ? (
        <Card className="mt-4 p-5">
          {editing ? (
            <Textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              rows={28}
              className="font-mono text-sm leading-relaxed"
              placeholder="Markdown report…"
            />
          ) : (
            <>
              <WalkthroughPhotoSteps
                steps={photoSteps}
                variant={isSummary ? "summary" : "recorded"}
              />
              <WalkthroughMarkdown
                markdown={renderedMarkdown}
                photoUrls={photoUrls}
                variant={isSummary ? "summary" : "recorded"}
              />
            </>
          )}
        </Card>
      ) : walk.status === "generating" || walk.status === "recording" ? (
        <Card className="mt-4 flex flex-col items-center gap-3 p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h2 className="text-lg font-semibold">Report is being generated…</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            We're transcribing your narration and writing the report. This usually takes under a
            minute. You can safely leave this page — it will update automatically when the report is
            ready.
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </Card>
      ) : walk.status === "failed" ? (
        <Card className="mt-4 flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
            <ImageOff className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold">
            We couldn't generate this {isSummary ? "summary" : "report"}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {isSummary
              ? "Something went wrong while writing your summary. Your photos are safe — try generating again."
              : "Something went wrong while creating your report. Your photos and narration are safe — try generating again."}
          </p>
          <Button size="sm" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Try again
          </Button>
        </Card>
      ) : (
        <Card className="mt-4 flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm text-muted-foreground">
              No {isSummary ? "summary" : "report"} yet.
            </p>
            {/* A summary spends no Auto Report quota, so quoting the meter here
                would tell the user a cost that does not exist — and quote a
                Pro-only allowance to a Starter user who can still do this. */}
            {!isSummary && canUseAutoReports && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {autoReportsLimit === Infinity
                  ? "Unlimited Auto Reports on Team"
                  : `${autoReportsUsed}/${autoReportsLimit} Auto Reports used this month`}
              </p>
            )}
          </div>
          <Button size="sm" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isSummary ? "Generate summary" : "Generate report"}
          </Button>
        </Card>
      )}

      <UpgradeDialog
        open={autoReportUpgradeOpen}
        onOpenChange={setAutoReportUpgradeOpen}
        feature="Auto Reports"
        description={
          !canUseAutoReports
            ? "Auto Reports (AI reports generated from a walkthrough's narration and photos) are a Pro and Team feature. Upgrade to generate reports from your walkthroughs."
            : `You've used all ${autoReportsLimit} Auto Reports included with Pro this month. Upgrade to Team for unlimited Auto Reports, or wait until next month.`
        }
        recommendedPlan={!canUseAutoReports ? "pro" : "team"}
      />
    </div>
  );
}
