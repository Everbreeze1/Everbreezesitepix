import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import {
  Upload,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Tag,
  Tag as TagIcon,
  Pencil,
  Save,
  Download,
  X,
  Copy,
  ScanText,
  Wrench,
  ListChecks,
  FileDown,
  Camera,
  RefreshCw,
  Plus,
  MessageSquare,
  LayoutGrid,
  CalendarDays,
} from "lucide-react";
import { startOfMonth } from "date-fns";
import { PhotoCalendar } from "@/features/gallery/components/PhotoCalendar";
import {
  PhotoCommentsPanel,
  type CommentContributor,
} from "@/features/photos/components/PhotoCommentsPanel";
import { PhotoTasksPanel } from "@/features/photos/components/PhotoTasksPanel";
import { PhotoDetailsPanel } from "@/features/photos/components/PhotoDetailsPanel";
import { analyzePhoto, getProjectContributors } from "@/features/gallery/api";

import { PhotoAnnotator } from "@/features/photos/components/PhotoAnnotator";
import { sharePhotoNative } from "@/lib/native-share";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/sitepix/client";
import { sitepixApi } from "@/lib/sitepix-api";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { useProfile } from "@/hooks/use-profile";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { PhotoThumb } from "@/components/PhotoThumb";
import { CameraCapture, compressImageFile } from "@/features/photos/components/CameraCapture";
import { TagPhotoDialog } from "@/features/photos/components/TagPhotoDialog";
import { applyWatermarkToFile, type BeforeAfterTag, type WatermarkContext } from "@/lib/watermark";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { BusyOverlay } from "@/components/BusyOverlay";
import { PhotoLightbox } from "@/features/photos/components/PhotoLightbox";
import { PhotoTagPopoverBody } from "@/features/photos/components/PhotoTagPopoverBody";
import { TagPill } from "@/features/photos/components/TagPill";
import { ensureGlobalTag } from "@/hooks/use-tag-colors";
import { cleanCaption } from "@sitepix/shared";

interface Photo {
  id: string;
  project_id: string;
  storage_path: string;
  image_url: string | null;
  caption: string | null;
  created_at: string;
  phase?: string | null;
  tags?: string[] | null;
}

interface Project {
  id: string;
  name: string;
  location?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}
interface Analysis {
  id: string;
  ocr_text: string | null;
  labels: string[] | null;
  defects: Array<{ type: string; severity: string; location?: string; description: string }> | null;
  report_text: string | null;
  recommendations: string[] | null;
  status: string;
  created_at: string;
}

const ANALYZE_STEPS = [
  { icon: ScanText, label: "Reading text & serial numbers…" },
  { icon: Tag, label: "Identifying equipment & scene…" },
  { icon: AlertTriangle, label: "Scanning for defects & hazards…" },
  { icon: FileText, label: "Drafting field report…" },
  { icon: ListChecks, label: "Generating recommendations…" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function GalleryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const {
    isActive,
    isPro,
    tier,
    aiAnalysesRemaining,
    aiAnalysesLimit,
    refresh: refreshSubscription,
    bumpAiAnalysesUsed,
  } = useSubscription();
  const { guard } = useSubscriptionGate();
  const { profile } = useProfile();
  const search = useSearch({ from: "/_app/gallery" as const });
  const watermarkOn =
    tier === "team" &&
    isActive &&
    !!profile?.company_logo_url &&
    profile?.watermark_enabled !== false;
  const watermarkUrl = watermarkOn ? profile!.company_logo_url : null;
  const reportWatermarkUrl = watermarkUrl;
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>(
    search.project ? [search.project] : [],
  );
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  /**
   * Grid vs calendar.
   *
   * The grid answers "what have we got"; it can't answer "what happened on the
   * 12th" or "which weeks were busy", which is most of what people bring to a
   * field-photo archive. In calendar mode the visible month *is* the date
   * range — the separate Date pill would be a second, contradictory way to say
   * the same thing, so it steps aside.
   *
   * The two views also load differently. The grid pages photos; the calendar
   * asks the server for day-bucketed counts and fetches only the day you open.
   * So the photo query below is switched off entirely in calendar mode, and
   * `photos` is instead filled from whatever day the calendar has loaded —
   * which keeps the lightbox, tag filter and per-photo panels working off the
   * same list in both views.
   */
  const [view, setView] = useState<"grid" | "calendar">(
    search.view === "calendar" ? "calendar" : "grid",
  );
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const calendarView = view === "calendar";
  const photoLimit = 200;
  const [tagSearch, setTagSearch] = useState<string>("");
  // Company-wide tag library (not just tags already applied to loaded
  // photos) so the filter picker matches the project label picker, which
  // also lists the full catalog rather than only currently-used values.
  const [globalTags, setGlobalTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analyzeStep, setAnalyzeStep] = useState(0);
  const [activePhoto, setActivePhoto] = useState<Photo | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [annotating, setAnnotating] = useState(false);

  const [contributorsByProject, setContributorsByProject] = useState<
    Record<string, CommentContributor[]>
  >({});
  const [contribsLoading, setContribsLoading] = useState<Record<string, boolean>>({});
  const fetchContribs = getProjectContributors;
  const ensureContribs = (projectId: string) => {
    if (contributorsByProject[projectId] || contribsLoading[projectId]) return;
    setContribsLoading((m) => ({ ...m, [projectId]: true }));
    fetchContribs({ data: { projectId } })
      .then((res: any) => {
        const list = (res.contributors ?? []).map((c: any) => ({
          userId: c.userId,
          fullName: c.fullName,
          email: c.email,
          avatarUrl: c.avatarUrl,
        })) as CommentContributor[];
        setContributorsByProject((m) => ({ ...m, [projectId]: list }));
      })
      .catch(() => {})
      .finally(() => setContribsLoading((m) => ({ ...m, [projectId]: false })));
  };

  // Native share replaces the old share dialog.
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    report_text: string;
    ocr_text: string;
    recommendations: string;
  }>({ report_text: "", ocr_text: "", recommendations: "" });
  const [saving, setSaving] = useState(false);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const analyze = analyzePhoto;

  const openCamera = () => guard(() => setCameraOpen(true), "Subscribe to capture new photos.");
  const openUpload = () =>
    guard(() => fileInput.current?.click(), "Subscribe to upload new photos.");

  const uploadProjectId = projectFilter.length === 1 ? projectFilter[0] : projects[0]?.id;
  const activeProject =
    projectFilter.length === 1 ? (projects.find((p) => p.id === projectFilter[0]) ?? null) : null;
  const projectAddress = (p: Project | null | undefined) => {
    if (!p) return null;
    const parts = [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean);
    return parts.length ? parts.join(" · ") : (p.location ?? null);
  };
  const watermarkCtx = (p: Project | null | undefined): WatermarkContext => ({
    projectName: p?.name ?? null,
    address: projectAddress(p),
    companyName: profile?.company ?? null,
    companyLogoUrl:
      tier === "team" && profile?.watermark_enabled !== false
        ? (profile?.company_logo_url ?? null)
        : null,
  });

  /**
   * Everything that changes after photos are added, edited or removed. The
   * calendar reads its own two caches, so a mutation that only busted
   * `galleryPhotos` used to leave the day counts stale.
   */
  const invalidatePhotoCaches = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.galleryPhotos(user?.id ?? "") }),
      qc.invalidateQueries({ queryKey: qk.galleryTotalPhotos(user?.id ?? "") }),
      qc.invalidateQueries({ queryKey: qk.photoActivity(user?.id ?? "") }),
      qc.invalidateQueries({ queryKey: qk.photoDay(user?.id ?? "") }),
    ]);

  const { pull, refreshing, indicatorStyle, progress } = usePullToRefresh({
    onRefresh: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.galleryProjects(user?.id ?? "") }),
        invalidatePhotoCaches(),
      ]);
    },
  });

  const onCameraCapture = async (
    file: File,
    opts: { analyze: boolean; tag: BeforeAfterTag; tags?: string[]; description?: string },
  ) => {
    if (!user) return;
    const projectId = uploadProjectId;
    if (!projectId) {
      toast.error("Create a project first");
      return;
    }

    setUploading(true);
    try {
      const compressed = await compressImageFile(file);
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("site-photos")
        .upload(path, compressed, { contentType: "image/jpeg" });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const desc = opts.description?.trim();
      const { data: inserted, error: insErr } = await supabase
        .from("photos")
        .insert({
          project_id: projectId,
          uploaded_by: user.id,
          storage_path: path,
          size_bytes: compressed.size,
          caption: desc && desc.length ? desc : `Photo ${new Date().toLocaleString()}`,
          phase: opts.tag ?? "untagged",
          tags: opts.tags && opts.tags.length ? opts.tags : undefined,
        } as any)
        .select("*")
        .single();

      if (insErr || !inserted) {
        toast.error(insErr?.message ?? "Insert failed");
        /*
         * Reclaim the blob we just uploaded. Without this a failed insert
         * leaves a file in the bucket that no row references — and it is
         * unreachable forever: `use-storage-usage` derives usage from
         * SUM(photos.size_bytes) so it isn't even counted, and every delete
         * path keys off `photos.storage_path`, so nothing in the product can
         * ever find it. This is the mirror of the delete ordering fixed
         * elsewhere: confirm the row before destroying the blob on the way
         * out, discard the blob when the row fails on the way in.
         */
        void supabase.storage.from("site-photos").remove([path]);
        return;
      }
      toast.success("Photo saved");
      await invalidatePhotoCaches();
      setCameraOpen(false);
      if (opts.analyze) {
        await openPhoto(inserted as Photo);
        void runAnalysis((inserted as Photo).id);
      }
    } finally {
      setUploading(false);
    }
  };

  const loadProjects = async (): Promise<Project[]> => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, street, city, state, zip")
      .order("created_at", { ascending: false });
    return (data as Project[]) ?? [];
  };

  const loadTotalPhotos = async (): Promise<number> => {
    if (!user) return 0;
    const { count } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("uploaded_by", user.id)
      .eq("archived", false)
      .is("deleted_at", null)
      .or("phase.is.null,phase.neq.walkthrough")
      .not("storage_path", "like", "%/walkthroughs/%");
    return count ?? 0;
  };

  const loadPhotos = async (): Promise<{ photos: Photo[]; signed: Record<string, string> }> => {
    let q = supabase
      .from("photos")
      .select("*")
      .eq("archived", false)
      .is("deleted_at", null)
      .or("phase.is.null,phase.neq.walkthrough")
      .not("storage_path", "like", "%/walkthroughs/%")
      .order("created_at", { ascending: false })
      .limit(photoLimit);
    if (projectFilter.length > 0) q = q.in("project_id", projectFilter);
    // `new Date("2026-08-31")` is UTC midnight, not local — west of Greenwich
    // that lands on the 30th, so the last day the user picked was being cut
    // off the range entirely. Pin both ends to local time explicitly.
    if (dateFrom) q = q.gte("created_at", new Date(`${dateFrom}T00:00:00`).toISOString());
    if (dateTo) q = q.lte("created_at", new Date(`${dateTo}T23:59:59.999`).toISOString());
    const { data } = await q;
    const ps = ((data as Photo[]) ?? []).filter(
      (p) => p.phase !== "walkthrough" && !p.storage_path.includes("/walkthroughs/"),
    );
    // Sign URLs in one batched request instead of one call per photo.
    const map: Record<string, string> = {};
    if (ps.length) {
      const paths = ps.map((p) => p.storage_path);
      const { data: signedUrls } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(paths, 3600);
      signedUrls?.forEach((s, i) => {
        if (s.signedUrl) map[ps[i].id] = s.signedUrl;
      });
    }
    return { photos: ps, signed: map };
  };

  // Each useQuery below is purely a scheduling gate — "do I actually need to
  // run load*() again, or is cached-and-fresh good enough". A useEffect
  // synced on each query's data (below) mirrors it into local useState so a
  // cache-hit remount (queryFn skipped) still repopulates the page instead
  // of rendering the useState initial (empty) values.
  const projectsQuery = useQuery({
    queryKey: qk.galleryProjects(user?.id ?? ""),
    queryFn: loadProjects,
    enabled: !!user,
    staleTime: 60_000,
  });
  const totalPhotosQuery = useQuery({
    queryKey: qk.galleryTotalPhotos(user?.id ?? ""),
    queryFn: loadTotalPhotos,
    enabled: !!user,
    staleTime: 60_000,
  });
  const photosQuery = useQuery({
    // Filters are part of the key, so switching filters naturally fetches
    // fresh (different key) while re-visiting a previously-seen filter
    // combo within staleTime serves from cache.
    queryKey: qk.galleryPhotos(user?.id ?? "", {
      projectFilter,
      dateFrom,
      dateTo,
    }),
    queryFn: loadPhotos,
    // Calendar mode has no use for a page of recent photos — it loads a day at
    // a time — and running this anyway was the single biggest cost of opening
    // the calendar.
    enabled: !!user && !calendarView,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (projectsQuery.data) setProjects(projectsQuery.data);
  }, [projectsQuery.data]);
  useEffect(() => {
    if (totalPhotosQuery.data !== undefined) setTotalPhotos(totalPhotosQuery.data);
  }, [totalPhotosQuery.data]);
  useEffect(() => {
    if (photosQuery.data) {
      setPhotos(photosQuery.data.photos);
      setSigned(photosQuery.data.signed);
    }
  }, [photosQuery.data]);

  // A disabled query stays `pending` forever, so calendar mode must not read
  // it as "still loading".
  const loading = !calendarView && photosQuery.isPending;

  useEffect(() => {
    if (search.project) setProjectFilter([search.project]);
  }, [search.project]);

  // `view` seeds from the URL, but the initial state only runs on mount — so
  // arriving at ?view=calendar while the gallery is already open (the /timeline
  // redirect, back/forward, a shared link) would leave the grid showing. Only
  // acts when the param is actually present, so navigating to a bare /gallery
  // doesn't yank the user out of the calendar.
  useEffect(() => {
    if (search.view) {
      setView(search.view);
      setSelectedDay(null);
      setPhotos([]);
      setSigned({});
    }
  }, [search.view]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("tags")
        .select("name")
        .order("name", { ascending: true });
      if (cancelled) return;
      setGlobalTags(((data as Array<{ name: string }>) ?? []).map((t) => t.name));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Client-side tag filter (any-of)
  const visiblePhotos =
    tagFilter.length === 0
      ? photos
      : photos.filter((p) => (p.tags ?? []).some((t) => tagFilter.includes(t)));
  const activeLightboxPhoto =
    lightboxIndex !== null
      ? (visiblePhotos[Math.min(lightboxIndex, visiblePhotos.length - 1)] ?? null)
      : null;
  useEffect(() => {
    if (!activeLightboxPhoto?.project_id) return;
    ensureContribs(activeLightboxPhoto.project_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLightboxPhoto?.project_id]);
  const allTags = globalTags;
  const filteredTagOptions = tagSearch
    ? allTags.filter((t) => t.toLowerCase().includes(tagSearch.toLowerCase()))
    : allTags;

  // Listen for email-report requests posted from the report popup window.
  // The popup never holds the user's JWT; it asks this opener page to perform
  // the authenticated send on its behalf, so the token never lands on disk
  // if the user saves the report HTML.
  useEffect(() => {
    const handler = async (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object" || msg.type !== "sitepix:email-report") return;
      if (ev.origin !== window.location.origin) return;
      const source = ev.source as Window | null;
      const reply = (payload: Record<string, unknown>) => {
        try {
          source?.postMessage(
            { type: "sitepix:email-report:result", requestId: msg.requestId, ...payload },
            window.location.origin,
          );
        } catch {
          /* ignore */
        }
      };
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session?.access_token) {
          reply({ ok: false, error: "Session expired — please sign in again." });
          return;
        }
        const result = await sitepixApi.email.sendFieldReport({
          subject: msg.subject,
          pdfBase64: msg.pdfBase64,
          pdfName: msg.pdfName,
        });
        reply({ ok: true, sentTo: result.sentTo });
      } catch (e: any) {
        reply({ ok: false, error: e?.message ?? "unknown error" });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const onUpload = (files: FileList | null) => {
    if (!files || !user) return;
    const projectId = uploadProjectId;
    if (!projectId) {
      toast.error("Create a project first");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const incoming = Array.from(files);
    setPendingFiles(incoming);
  };

  const processPendingWithTag = async (tag: BeforeAfterTag) => {
    const incoming = pendingFiles;
    setPendingFiles(null);
    if (!incoming || !user) return;
    const projectId = uploadProjectId;
    if (!projectId) {
      toast.error("Create a project first");
      return;
    }
    const projectForWatermark = projects.find((p) => p.id === projectId) ?? null;
    setUploading(true);
    try {
      for (const rawFile of incoming) {
        const tagged = await applyWatermarkToFile(rawFile, {
          ...watermarkCtx(projectForWatermark),
          tag,
        });
        const file = await compressImageFile(tagged);
        const path = `${user.id}/${projectId}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("site-photos")
          .upload(path, file, { contentType: file.type });
        if (upErr) {
          toast.error(upErr.message);
          continue;
        }
        const { error: insErr } = await supabase.from("photos").insert({
          project_id: projectId,
          uploaded_by: user.id,
          storage_path: path,
          size_bytes: file.size,
          caption: file.name,
          phase: tag ?? "untagged",
        });
        if (insErr) {
          toast.error(insErr.message);
          // Reclaim the orphaned upload — nothing else can, see `saveCapture`.
          void supabase.storage.from("site-photos").remove([path]);
        }
      }
      toast.success("Photos uploaded");
      await invalidatePhotoCaches();
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const openPhoto = async (p: Photo) => {
    setActivePhoto(p);
    const idx = visiblePhotos.findIndex((x) => x.id === p.id);
    if (idx >= 0) setLightboxIndex(idx);
    setAnalysis(null);
    const { data } = await supabase
      .from("ai_analyses")
      .select("*")
      .eq("photo_id", p.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) setAnalysis(data as Analysis);
  };

  const togglePhotoTag = async (photoId: string, t: string) => {
    const ph = photos.find((p) => p.id === photoId);
    if (!ph) return;
    const has = (ph.tags ?? []).includes(t);
    const next = has ? (ph.tags ?? []).filter((x) => x !== t) : [...(ph.tags ?? []), t];
    setPhotos((ps) => ps.map((p) => (p.id === photoId ? { ...p, tags: next } : p)));
    if (activePhoto?.id === photoId) setActivePhoto({ ...ph, tags: next });
    if (!has) void ensureGlobalTag(t, undefined, user?.id ?? null);
    const { error } = await supabase
      .from("photos")
      .update({ tags: next } as any)
      .eq("id", photoId);
    if (error) {
      toast.error(error.message);
      setPhotos((ps) => ps.map((p) => (p.id === photoId ? { ...p, tags: ph.tags ?? [] } : p)));
      return;
    }
    // Roll up to project_tags so dashboard filters reflect new tags.
    try {
      const { data: tagRow } = await (supabase as any)
        .from("tags")
        .select("id")
        .eq("name", t)
        .maybeSingle();
      if (!tagRow?.id) return;
      if (!has) {
        await (supabase as any)
          .from("project_tags")
          .upsert(
            { project_id: ph.project_id, tag_id: tagRow.id, created_by: user?.id },
            { onConflict: "project_id,tag_id", ignoreDuplicates: true },
          );
      }
    } catch {
      /* non-fatal */
    }
  };

  const runAnalysis = async (photoId: string) => {
    if (!isActive) {
      setPaywallOpen(true);
      toast.error(
        "AI photo analysis is a paid feature. Upgrade to Starter or Team to continue — both include unlimited AI scans.",
      );
      return;
    }
    setAnalyzing(photoId);
    setAnalyzeStep(0);
    const stepTimer = setInterval(() => {
      setAnalyzeStep((s) => (s + 1) % ANALYZE_STEPS.length);
    }, 1800);
    try {
      const result = await analyze({ data: { photoId } });
      bumpAiAnalysesUsed();
      void refreshSubscription();
      toast.success("Analysis complete");
      setAnalysis({
        id: result.id,
        ocr_text: result.ocr_text,
        labels: result.labels,
        defects: result.defects,
        report_text: result.report_text,
        recommendations: result.recommendations,
        status: "completed",
        created_at: new Date().toISOString(),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("limit reached")) {
        setPaywallOpen(true);
      }
      toast.error(msg);
    } finally {
      clearInterval(stepTimer);
      setAnalyzing(null);
      setAnalyzeStep(0);
    }
  };

  const severityColor = (s: string) =>
    s === "critical"
      ? "bg-destructive text-destructive-foreground"
      : s === "high"
        ? "bg-destructive/80 text-destructive-foreground"
        : s === "medium"
          ? "bg-safety text-safety-foreground"
          : "bg-muted text-foreground";

  const buildReportText = (a: Analysis, photo: Photo | null) => {
    const lines: string[] = [];
    lines.push(`SitePix AI Analysis`);
    if (photo?.caption) lines.push(`Photo: ${photo.caption}`);
    lines.push(`Date: ${new Date(a.created_at).toLocaleString()}`);
    lines.push("");
    if (a.ocr_text) {
      lines.push("OCR / Text on equipment:", a.ocr_text, "");
    }
    if (a.labels?.length) {
      lines.push("Labels: " + a.labels.join(", "), "");
    }
    if (a.defects?.length) {
      lines.push("Defects:");
      a.defects.forEach((d) =>
        lines.push(
          `- [${d.severity.toUpperCase()}] ${d.type}${d.location ? ` (${d.location})` : ""}: ${d.description}`,
        ),
      );
      lines.push("");
    }
    if (a.report_text) {
      lines.push("Field Report:", a.report_text, "");
    }
    if (a.recommendations?.length) {
      lines.push("Recommendations:");
      a.recommendations.forEach((r) => lines.push(`- ${r}`));
    }
    return lines.join("\n");
  };

  const startEdit = () => {
    if (!analysis) return;
    setDraft({
      report_text: analysis.report_text ?? "",
      ocr_text: analysis.ocr_text ?? "",
      recommendations: (analysis.recommendations ?? []).join("\n"),
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!analysis) return;
    setSaving(true);
    const recs = draft.recommendations
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const { error } = await supabase
      .from("ai_analyses")
      .update({
        report_text: draft.report_text || null,
        ocr_text: draft.ocr_text || null,
        recommendations: recs,
      })
      .eq("id", analysis.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAnalysis({
      ...analysis,
      report_text: draft.report_text || null,
      ocr_text: draft.ocr_text || null,
      recommendations: recs,
    });
    setEditing(false);
    toast.success("Analysis saved");
  };

  const downloadReport = () => {
    if (!analysis) return;
    const text = buildReportText(analysis, activePhoto);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sitepix-report-${analysis.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const buildReportHtml = (
    a: Analysis,
    photo: Photo,
    imgSrc: string,
    note: string,
    watermark: string | null,
  ) => {
    const sev = (s: string) =>
      s === "critical" || s === "high" ? "#b91c1c" : s === "medium" ? "#b45309" : "#374151";
    const defectsHtml = (a.defects ?? [])
      .map(
        (d) => `
      <li style="margin:0 0 10px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;">
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#fff;background:${sev(d.severity)};padding:2px 8px;border-radius:999px;">${escapeHtml(d.severity)}</span>
          <strong>${escapeHtml(d.type)}</strong>
        </div>
        ${d.location ? `<div style="margin-top:4px;color:#6b7280;font-size:12px;">${escapeHtml(d.location)}</div>` : ""}
        <div style="margin-top:6px;">${escapeHtml(d.description)}</div>
      </li>`,
      )
      .join("");
    const recsHtml = (a.recommendations ?? [])
      .map((r) => `<li style="margin:4px 0;">${escapeHtml(r)}</li>`)
      .join("");
    const labelsHtml = (a.labels ?? [])
      .map(
        (l) =>
          `<span style="display:inline-block;margin:0 6px 6px 0;padding:2px 8px;border:1px solid #e5e7eb;border-radius:999px;font-size:12px;color:#374151;">${escapeHtml(l)}</span>`,
      )
      .join("");
    const fileSlug = `sitepix-report-${a.id.slice(0, 8)}.pdf`;
    const subject = `SitePix report — ${photo.caption ?? "Site photo"}`;
    const opener_origin = window.location.origin;

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>SitePix Report — ${escapeHtml(photo.caption ?? "Photo")}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111827;margin:0;background:#f3f4f6;}
  .toolbar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #e5e7eb;padding:10px 16px;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;}
  .btn{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;}
  .btn:disabled{opacity:.6;cursor:wait;}
  .btn-primary{background:#111827;color:#fff;border-color:#111827;}
  .page{max-width:820px;margin:24px auto;background:#fff;padding:36px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
  h1{font-size:22px;margin:0 0 4px;}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:24px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;}
  .meta{color:#6b7280;font-size:13px;margin-bottom:18px;}
  .hero-wrap{position:relative;display:inline-block;width:100%;margin:8px 0 4px;}
  .hero{width:100%;border-radius:10px;border:1px solid #e5e7eb;display:block;}
  .hero-watermark{position:absolute;right:14px;bottom:14px;max-width:28%;max-height:22%;width:auto;height:auto;opacity:.82;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45));pointer-events:none;}
  .note{background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:6px;margin:0 0 14px;white-space:pre-wrap;}
  pre{white-space:pre-wrap;font-family:inherit;background:#f9fafb;padding:10px;border-radius:8px;border:1px solid #e5e7eb;margin:0;}
  ul{padding-left:0;list-style:none;margin:0;}
  ul.disc{padding-left:20px;list-style:disc;}
  .email-bar{display:none;width:calc(100% - 32px);gap:8px;align-items:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin:8px 16px 0;}
  .email-bar input{flex:1;min-width:200px;font:inherit;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;}
  .status{font-size:13px;color:#374151;margin-left:auto;}
  .status.err{color:#b91c1c;}
  .status.ok{color:#047857;}
  @media print { .toolbar,.email-bar{display:none !important;} body{background:#fff;} .page{box-shadow:none;margin:0;max-width:none;padding:0;} }
</style></head>
<body>
  <div class="toolbar">
    <button class="btn" onclick="window.print()">Print</button>
    <button class="btn btn-primary" id="email-toggle">Email as Attachment</button>
  </div>
  <div id="email-bar" class="email-bar">
    <span style="flex:1;font-size:13px;color:#374151;">Send a copy to your account email.</span>
    <button class="btn btn-primary" id="email-send">Send PDF</button>
    <span id="email-status" class="status"></span>
  </div>
  <div id="report" class="page">
    <h1>SitePix Field Report</h1>
    <div class="meta">
      ${photo.caption ? `<strong>${escapeHtml(photo.caption)}</strong> · ` : ""}
      ${escapeHtml(new Date(a.created_at).toLocaleString())}
    </div>
    ${note ? `<div class="note">${escapeHtml(note)}</div>` : ""}
    <div class="hero-wrap">
      <img id="hero-img" class="hero" src="${imgSrc}" alt="Site photo" crossorigin="anonymous" />
      ${watermark ? `<img class="hero-watermark" src="${watermark}" alt="" crossorigin="anonymous" />` : ""}
    </div>
    ${a.labels?.length ? `<h2>Labels</h2><div>${labelsHtml}</div>` : ""}
    ${a.ocr_text ? `<h2>Text on Equipment (OCR)</h2><pre>${escapeHtml(a.ocr_text)}</pre>` : ""}
    ${a.defects?.length ? `<h2>Defects</h2><ul>${defectsHtml}</ul>` : ""}
    ${a.report_text ? `<h2>Field Report</h2><pre>${escapeHtml(a.report_text)}</pre>` : ""}
    ${a.recommendations?.length ? `<h2>Recommendations</h2><ul class="disc">${recsHtml}</ul>` : ""}
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" integrity="sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" integrity="sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script>
    (function(){
      var SUBJECT = ${JSON.stringify(subject)};
      var FILE_NAME = ${JSON.stringify(fileSlug)};
      var OPENER_ORIGIN = ${JSON.stringify(opener_origin)};
      var bar = document.getElementById('email-bar');
      var toggle = document.getElementById('email-toggle');
      var sendBtn = document.getElementById('email-send');
      var status = document.getElementById('email-status');
      toggle.addEventListener('click', function(){
        bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
      });
      async function generatePdf(){
        var node = document.getElementById('report');
        var canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ unit: 'pt', format: 'a4' });
        var pageW = pdf.internal.pageSize.getWidth();
        var pageH = pdf.internal.pageSize.getHeight();
        var imgW = pageW - 40;
        var sliceH = Math.floor((pageH - 40) * canvas.width / imgW);
        var sY = 0;
        var first = true;
        while (sY < canvas.height) {
          var h = Math.min(sliceH, canvas.height - sY);
          var c2 = document.createElement('canvas');
          c2.width = canvas.width; c2.height = h;
          var ctx = c2.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0,0,c2.width,c2.height);
          ctx.drawImage(canvas, 0, sY, canvas.width, h, 0, 0, canvas.width, h);
          var sliceData = c2.toDataURL('image/jpeg', 0.92);
          var renderedH = h * imgW / canvas.width;
          if (!first) pdf.addPage();
          pdf.addImage(sliceData, 'JPEG', 20, 20, imgW, renderedH);
          first = false;
          sY += h;
        }
        return pdf.output('datauristring').split(',')[1];
      }
      sendBtn.addEventListener('click', async function(){
        if (!window.opener || window.opener.closed) {
          status.className='status err';
          status.textContent='Original tab closed — reopen the report from the gallery to send.';
          return;
        }
        sendBtn.disabled = true; toggle.disabled = true;
        status.className='status'; status.textContent='Generating PDF…';
        try {
          var pdfBase64 = await generatePdf();
          status.textContent='Sending…';
          var requestId = String(Date.now()) + Math.random().toString(36).slice(2);
          var result = await new Promise(function(resolve, reject){
            var timeoutId = setTimeout(function(){
              window.removeEventListener('message', onMsg);
              reject(new Error('Timed out waiting for response from main tab.'));
            }, 60000);
            function onMsg(ev){
              if (ev.origin !== OPENER_ORIGIN) return;
              var d = ev.data;
              if (!d || d.type !== 'sitepix:email-report:result' || d.requestId !== requestId) return;
              clearTimeout(timeoutId);
              window.removeEventListener('message', onMsg);
              resolve(d);
            }
            window.addEventListener('message', onMsg);
            window.opener.postMessage({
              type: 'sitepix:email-report',
              requestId: requestId,
              subject: SUBJECT,
              pdfBase64: pdfBase64,
              pdfName: FILE_NAME,
            }, OPENER_ORIGIN);
          });
          if (!result.ok) throw new Error(result.error || 'Send failed');
          status.className='status ok'; status.textContent='Sent to ' + (result.sentTo || 'your account email');
        } catch (e) {
          console.error(e);
          status.className='status err'; status.textContent='Failed: ' + (e && e.message ? e.message : 'unknown error');
        } finally {
          sendBtn.disabled = false; toggle.disabled = false;
        }
      });
    })();
  </script>
</body></html>`;
  };

  const openFormattedReport = async () => {
    if (!analysis || !activePhoto) return;
    const imgSrc = signed[activePhoto.id] ?? activePhoto.image_url ?? "";
    const html = buildReportHtml(analysis, activePhoto, imgSrc, "", reportWatermarkUrl);
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Pop-up blocked — allow pop-ups to export the report");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const previewReport = () => {
    openFormattedReport();
  };

  const saveAnnotatedPhoto = async (blob: Blob) => {
    if (!activePhoto || !user) return;
    if (!isActive) {
      setAnnotating(false);
      guard(() => {}, "Subscribe to save annotated photos.");
      return;
    }
    try {
      const path = `${user.id}/${activePhoto.project_id}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("site-photos")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const baseCaption = activePhoto.caption ?? "Photo";
      const { error: insErr } = await supabase.from("photos").insert({
        project_id: activePhoto.project_id,
        uploaded_by: user.id,
        storage_path: path,
        size_bytes: blob.size,
        caption: baseCaption.startsWith("Annotated:") ? baseCaption : `Annotated: ${baseCaption}`,
      } as any);
      if (insErr) throw insErr;
      toast.success("Annotated photo saved");
      setAnnotating(false);
      await invalidatePhotoCaches();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save annotated photo");
    }
  };

  return (
    <div
      className="container mx-auto px-4 pb-24 pt-6 md:pt-10"
      style={{
        transform: `translateY(${Math.min(pull, 70) * 0.5}px)`,
        transition: refreshing || pull === 0 ? "transform 200ms ease" : undefined,
      }}
    >
      {(pull > 0 || refreshing) && (
        <div
          className="pointer-events-none fixed left-1/2 top-2 z-50 -translate-x-1/2"
          style={indicatorStyle}
        >
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-md">
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
            />
            {refreshing ? "Refreshing…" : progress >= 1 ? "Release to refresh" : "Pull to refresh"}
          </div>
        </div>
      )}
      <BusyOverlay
        open={uploading}
        title="Uploading photos…"
        description="Saving to your project"
      />
      <BusyOverlay
        open={!!analyzing}
        variant="analyze"
        title="Analyzing with AI…"
        description="Reading text, detecting defects, drafting findings"
      />
      <PageHeader
        eyebrow="Media library"
        title={
          <span className="flex items-center gap-2">
            Photo gallery
            <span
              className={`inline-flex items-center rounded-lg px-2.5 py-0.5 font-manrope text-[10px] font-semibold shadow-sm ${
                isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {isActive ? (tier === "team" ? "Team" : "Pro") : "Free"}
            </span>
          </span>
        }
        description="Capture, upload, and analyze site photos."
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onUpload(e.target.files)}
            />
            <Button
              onClick={openCamera}
              disabled={uploading || projects.length === 0}
              className="h-11 flex-1 rounded-lg bg-primary px-5 font-manrope text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 sm:flex-none"
            >
              <Camera className="mr-2 h-4 w-4" />
              Take photo
            </Button>
            <Button
              variant="outline"
              onClick={openUpload}
              disabled={uploading || projects.length === 0}
              className="h-11 flex-1 rounded-lg border-border bg-card px-4 font-manrope text-sm font-medium text-foreground shadow-sm hover:bg-card/80 sm:flex-none"
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      />

      {projects.length === 0 && (
        <Card className="mt-6 flex flex-col items-center p-10 text-center border-dashed">
          <Camera className="h-10 w-10 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">No project yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Create a project first — photos are organized by job site.
          </p>
          <Button asChild className="mt-4">
            <Link to="/projects/new">Create project</Link>
          </Button>
        </Card>
      )}

      {projects.length > 0 && (
        <div className="mt-5 rounded-[14px] border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Grid vs calendar. Segmented, so the current mode is never in doubt. */}
            <div className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted p-0.5">
              {(
                [
                  { key: "grid", label: "Grid", icon: LayoutGrid },
                  { key: "calendar", label: "Calendar", icon: CalendarDays },
                ] as const
              ).map((v) => {
                const on = view === v.key;
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => {
                      setView(v.key);
                      // A day picked in a previous session would otherwise sit
                      // selected in a month it doesn't belong to.
                      setSelectedDay(null);
                      // The two views fill `photos` from different sources, so
                      // hand over empty rather than letting one view's list
                      // flash inside the other.
                      setPhotos([]);
                      setSigned({});
                    }}
                    aria-pressed={on}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-manrope text-xs font-bold transition ${
                      on
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <v.icon className="h-3.5 w-3.5" />
                    {v.label}
                  </button>
                );
              })}
            </div>

            <span aria-hidden className="mx-0.5 hidden h-6 w-px shrink-0 bg-border sm:block" />

            {/* Projects multi-select */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-3 font-manrope text-background"
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.3px]">Projects</span>
                  <span className="text-sm font-medium">
                    {projectFilter.length === 0
                      ? "All"
                      : projectFilter.length === 1
                        ? (projects.find((p) => p.id === projectFilter[0])?.name ?? "1 selected")
                        : `${projectFilter.length} selected`}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Projects
                  </span>
                  {projectFilter.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setProjectFilter([])}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {projects.map((p) => {
                    const active = projectFilter.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          setProjectFilter((s) =>
                            s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id],
                          )
                        }
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${active ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                        >
                          {active && <CheckCircle2 className="h-3 w-3" />}
                        </span>
                        <span className="truncate">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            {/* Date range — in calendar view the visible month already is the
                range, so this would be a second way to say the same thing. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 font-manrope text-foreground ${
                    calendarView ? "hidden" : ""
                  }`}
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.3px] text-muted-foreground">
                    Date
                  </span>
                  <span className="text-sm font-medium">
                    {dateFrom || dateTo ? `${dateFrom || "…"} → ${dateTo || "…"}` : "Any"}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Date range
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  {(dateFrom || dateTo) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                      }}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* Tags multi-select searchable */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 font-manrope text-foreground"
                >
                  <TagIcon className="h-3.5 w-3.5 text-foreground" />
                  <span className="text-xs font-semibold uppercase tracking-[0.3px] text-muted-foreground">
                    Tags
                  </span>
                  <span className="text-sm font-medium">
                    {tagFilter.length === 0 ? "Any" : `${tagFilter.length} selected`}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tags
                  </span>
                  {tagFilter.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setTagFilter([])}
                      className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="Search tags…"
                  className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                />
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {filteredTagOptions.length === 0 ? (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      {allTags.length === 0 ? "No tags yet" : "No matching tags"}
                    </div>
                  ) : (
                    filteredTagOptions.map((t) => {
                      const active = tagFilter.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() =>
                            setTagFilter((s) =>
                              s.includes(t) ? s.filter((x) => x !== t) : [...s, t],
                            )
                          }
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition ${active ? "bg-primary/10" : "hover:bg-muted"}`}
                        >
                          <TagPill name={t} size="sm" />
                          <CheckCircle2
                            className={`h-3.5 w-3.5 shrink-0 text-primary ${active ? "" : "opacity-0"}`}
                          />
                        </button>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {(projectFilter.length > 0 ||
              tagFilter.length > 0 ||
              (!calendarView && (dateFrom || dateTo))) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 font-manrope text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  setProjectFilter([]);
                  setTagFilter([]);
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear all
              </Button>
            )}

            {!calendarView && (
              <div className="ml-auto font-manrope text-xs font-bold text-muted-foreground">
                {visiblePhotos.length} of {photos.length} photo
                {photos.length === 1 ? "" : "s"}
              </div>
            )}
          </div>
        </div>
      )}

      {projects.length > 0 && calendarView && (
        <PhotoCalendar
          month={month}
          onMonthChange={(next) => {
            setMonth(next);
            setSelectedDay(null);
          }}
          projectIds={projectFilter}
          tags={tagFilter}
          projects={projects}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          // The calendar owns the fetch; mirroring the day's photos into the
          // page's own list is what lets the lightbox, comments and AI panels
          // keep working unchanged from here.
          onDayPhotosChange={(dayPhotos, daySigned) => {
            setPhotos(dayPhotos as Photo[]);
            setSigned(daySigned);
          }}
          onOpenPhoto={(p) => void openPhoto(p as Photo)}
        />
      )}

      {/* Unmounted rather than hidden in calendar view — a `hidden` grid still
          mounts every tile and fires a signed-thumbnail request per photo. */}
      {!calendarView && (
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {loading ? (
            <Card className="col-span-full p-8 text-center text-muted-foreground">
              Loading photos…
            </Card>
          ) : visiblePhotos.length === 0 ? (
            projects.length > 0 && (
              <Card className="col-span-full flex flex-col items-center p-12 text-center border-dashed">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <h2 className="mt-3 text-lg font-semibold">
                  {photos.length === 0 ? "No photos yet" : "No photos match your filters"}
                </h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {photos.length === 0
                    ? "Snap a photo on-site or upload from your device."
                    : "Try adjusting projects, dates, or tags."}
                </p>
                {photos.length === 0 && (
                  <div className="mt-4 flex gap-2">
                    <Button onClick={openCamera} disabled={uploading}>
                      <Camera className="mr-2 h-4 w-4" />
                      Take photo
                    </Button>
                    <Button variant="outline" onClick={openUpload} disabled={uploading}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload
                    </Button>
                  </div>
                )}
              </Card>
            )
          ) : (
            visiblePhotos.map((p) => {
              const project = projects.find((pr) => pr.id === p.project_id);
              return (
                <button
                  key={p.id}
                  onClick={() => openPhoto(p)}
                  className="group flex flex-col overflow-hidden rounded-3xl bg-sidebar text-left shadow-[0_20px_35px_-26px_rgba(16,25,41,0.55)] transition-transform hover:-translate-y-0.5"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden">
                    {/* Thumbnail, not the camera original — a 200-photo grid of
                      full-res site photos is the single heaviest thing in the
                      app on a phone. Falls back to the full image if the
                      project's plan has no image transformation. */}
                    <PhotoThumb
                      storagePath={p.storage_path}
                      fallbackUrl={signed[p.id]}
                      width={400}
                      alt={p.caption ?? ""}
                      className="transition duration-300 group-hover:scale-105"
                    />
                    {watermarkUrl && signed[p.id] && (
                      <img
                        src={watermarkUrl}
                        alt=""
                        aria-hidden
                        className="pointer-events-none absolute bottom-2 right-2 h-7 w-auto max-w-[35%] opacity-40 drop-shadow-sm"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-sidebar/90 to-transparent px-4 pb-3 pt-8">
                      <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[1.2px] text-sidebar-foreground/90">
                        Site record
                      </p>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <p className="truncate font-manrope text-[11px] font-bold text-sidebar-foreground/70">
                      {cleanCaption(p.caption) ??
                        `${project?.name ?? "Unassigned"} · ${timeAgo(p.created_at)}`}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      {projects.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={uploading}
              aria-label="Add photo"
              className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-95 disabled:opacity-60 md:hidden"
            >
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Plus className="h-6 w-6" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="mb-2 w-56">
            <DropdownMenuItem onClick={openCamera}>
              <Camera className="mr-2 h-4 w-4" />
              Take photo with camera
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openUpload}>
              <Upload className="mr-2 h-4 w-4" />
              Upload from gallery
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {lightboxIndex !== null && visiblePhotos.length > 0 && (
        <PhotoLightbox
          photos={visiblePhotos.map((p) => ({
            id: p.id,
            url: signed[p.id] ?? p.image_url ?? "",
            caption: p.caption,
            takenAt: p.created_at,
          }))}
          index={Math.min(lightboxIndex, visiblePhotos.length - 1)}
          onClose={() => {
            setLightboxIndex(null);
            setActivePhoto(null);
            setEditing(false);
            setAnalysisOpen(false);
          }}
          onIndexChange={(i) => {
            setLightboxIndex(i);
            const p = visiblePhotos[i];
            if (p) void openPhoto(p);
          }}
          renderActions={(lp) => {
            const ph = visiblePhotos.find((x) => x.id === lp.id);
            if (!ph) return null;
            return (
              <button
                type="button"
                aria-label="Annotate photo"
                title="Annotate"
                onClick={() => setAnnotating(true)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-foreground/10 text-sidebar-foreground hover:bg-sidebar-foreground/20 transition"
              >
                <Pencil className="h-5 w-5" />
              </button>
            );
          }}
          onSharePhoto={(lp) => {
            const ph = visiblePhotos.find((x) => x.id === lp.id);
            if (!ph) return;
            void sharePhotoNative({
              url: signed[ph.id] ?? ph.image_url ?? "",
              title: ph.caption ?? "Photo",
            });
          }}
          renderSidePanel={(lp) => {
            if (!user) return null;
            const ph = visiblePhotos.find((x) => x.id === lp.id);
            if (!ph) return null;
            const proj = projects.find((p) => p.id === ph.project_id) ?? null;
            const photoTags = ph.tags ?? [];
            return (
              <PhotoDetailsPanel
                project={{
                  name: proj?.name ?? "Project",
                  address: projectAddress(proj),
                }}
                photo={{
                  id: ph.id,
                  takenAt: ph.created_at,
                  latitude: (ph as any).latitude ?? null,
                  longitude: (ph as any).longitude ?? null,
                }}
                description={cleanCaption(ph.caption) || null}
                onSaveDescription={async (next) => {
                  const { error } = await supabase
                    .from("photos")
                    .update({ caption: next } as any)
                    .eq("id", ph.id);
                  if (error) throw error;
                  setPhotos((prev) =>
                    prev.map((p) => (p.id === ph.id ? { ...p, caption: next } : p)),
                  );
                  toast.success("Description saved");
                }}
                tagsSlot={
                  <div className="flex flex-wrap items-center gap-1.5">
                    {photoTags.map((t) => (
                      <TagPill
                        key={t}
                        name={t}
                        size="md"
                        onRemove={() => togglePhotoTag(ph.id, t)}
                      />
                    ))}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-sidebar-border bg-sidebar-foreground/[0.03] px-2.5 text-[11px] font-medium text-sidebar-foreground/70 transition hover:border-sidebar-foreground/40 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
                        >
                          <TagIcon className="h-3 w-3" />
                          {photoTags.length === 0 ? "Add tags" : "Edit"}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="z-[120] w-64 p-2">
                        <PhotoTagPopoverBody
                          photoTags={photoTags}
                          onToggle={(t) => togglePhotoTag(ph.id, t)}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                }
                tasksSlot={
                  <PhotoTasksPanel
                    photoId={lp.id}
                    projectId={ph.project_id}
                    currentUserId={user.id}
                    contributors={contributorsByProject[ph.project_id] ?? []}
                  />
                }
                commentsSlot={
                  <PhotoCommentsPanel
                    photoId={lp.id}
                    projectId={ph.project_id}
                    currentUserId={user.id}
                    contributors={contributorsByProject[ph.project_id] ?? []}
                    contributorsLoading={
                      !!contribsLoading[ph.project_id] && !contributorsByProject[ph.project_id]
                    }
                  />
                }
              />
            );
          }}
        />
      )}

      <Dialog
        open={analysisOpen && !!activePhoto}
        onOpenChange={(o) => {
          if (!o) {
            setAnalysisOpen(false);
            setEditing(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Analysis
            </DialogTitle>
          </DialogHeader>
          {activePhoto && (
            <div className="space-y-3">
              {!analysis ? (
                analyzing === activePhoto.id ? (
                  <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-5">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                        <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">AI is analyzing…</p>
                        <p className="text-xs text-muted-foreground">
                          This usually takes 10–25 seconds.
                        </p>
                      </div>
                    </div>
                    <ul className="space-y-2">
                      {ANALYZE_STEPS.map((s, i) => {
                        const Icon = s.icon;
                        const done = i < analyzeStep;
                        const active = i === analyzeStep;
                        return (
                          <li
                            key={i}
                            className={`flex items-center gap-2 text-sm transition ${done ? "text-foreground" : active ? "text-primary font-medium" : "text-muted-foreground/60"}`}
                          >
                            {done ? (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            ) : active ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <Icon className="h-4 w-4" />
                            )}
                            <span>{s.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <p className="text-sm text-muted-foreground">No analysis yet for this photo.</p>
                    <Button onClick={() => void runAnalysis(activePhoto.id)}>
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      Run AI analysis
                    </Button>
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 pb-2 border-b">
                    {!editing ? (
                      <>
                        <Button size="sm" onClick={previewReport}>
                          <FileDown className="mr-1 h-3.5 w-3.5" />
                          Export as PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={startEdit}>
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={downloadReport}>
                          <Download className="mr-1 h-3.5 w-3.5" />
                          .txt
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              buildReportText(analysis, activePhoto),
                            );
                            toast.success("Copied");
                          }}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          Copy
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" onClick={saveEdit} disabled={saving}>
                          {saving ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="mr-1 h-3.5 w-3.5" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(false)}
                          disabled={saving}
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>

                  {editing ? (
                    <div className="space-y-3">
                      <div>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                          OCR Text
                        </h4>
                        <Textarea
                          rows={3}
                          value={draft.ocr_text}
                          onChange={(e) => setDraft({ ...draft, ocr_text: e.target.value })}
                        />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                          Field Report
                        </h4>
                        <Textarea
                          rows={6}
                          value={draft.report_text}
                          onChange={(e) => setDraft({ ...draft, report_text: e.target.value })}
                        />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                          Recommendations (one per line)
                        </h4>
                        <Textarea
                          rows={5}
                          value={draft.recommendations}
                          onChange={(e) => setDraft({ ...draft, recommendations: e.target.value })}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      {analysis.ocr_text && (
                        <div>
                          <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                            <ScanText className="h-3 w-3" />
                            Extracted Text / Serial Numbers
                          </h4>
                          <p className="mt-1 rounded bg-muted p-2 text-sm font-mono">
                            {analysis.ocr_text}
                          </p>
                        </div>
                      )}
                      {analysis.labels && analysis.labels.length > 0 && (
                        <div>
                          <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                            <Tag className="h-3 w-3" />
                            Labels
                          </h4>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {analysis.labels.map((l, i) => (
                              <Badge key={i} variant="secondary">
                                {l}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {analysis.defects && analysis.defects.length > 0 && (
                        <div>
                          <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                            <Wrench className="h-3 w-3" />
                            Detected Issues & Defects
                          </h4>
                          <ul className="mt-1 space-y-2">
                            {analysis.defects.map((d, i) => (
                              <li key={i} className="rounded border p-2 text-sm">
                                <div className="flex items-center gap-2">
                                  <Badge className={severityColor(d.severity)}>{d.severity}</Badge>
                                  <span className="font-medium">{d.type}</span>
                                </div>
                                {d.location && (
                                  <p className="mt-1 text-xs text-muted-foreground">{d.location}</p>
                                )}
                                <p className="mt-1">{d.description}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {analysis.report_text && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                            Field Report
                          </h4>
                          <p className="mt-1 whitespace-pre-wrap text-sm">{analysis.report_text}</p>
                        </div>
                      )}
                      {analysis.recommendations && analysis.recommendations.length > 0 && (
                        <div>
                          <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3" />
                            Recommendations
                          </h4>
                          <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
                            {analysis.recommendations.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={paywallOpen} onOpenChange={setPaywallOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Upgrade to unlock AI
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pro and Team plans include unlimited AI photo analysis:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                Extract serial &amp; model numbers (OCR)
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                Detect defects, damage &amp; hazards
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                Auto-generated, exportable field reports
              </li>
            </ul>
          </div>
          <Button className="w-full" disabled>
            <Sparkles className="mr-2 h-4 w-4" />
            Not available
          </Button>
        </DialogContent>
      </Dialog>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={onCameraCapture}
        canAnalyze={isActive && aiAnalysesRemaining > 0}
        canMeasure={isPro}
      />

      {activePhoto && signed[activePhoto.id] && (
        <PhotoAnnotator
          open={annotating}
          imageUrl={signed[activePhoto.id]}
          onClose={() => setAnnotating(false)}
          onSave={saveAnnotatedPhoto}
          canMeasure={isPro}
        />
      )}
    </div>
  );
}
