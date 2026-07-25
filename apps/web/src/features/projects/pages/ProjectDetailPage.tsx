import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  ArrowLeft,
  MapPin,
  Camera,
  Sparkles,
  Calendar,
  Loader2,
  ImageOff,
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  FileDown,
  RefreshCw,
  Tag as TagIcon,
  X,
  Plus,
  Check,
  Video,
  Footprints,
  Mic,
  PlayCircle,
  Images,
  Trash2,
  Info,
  Pencil,
  CheckSquare,
  Workflow,
  ListChecks,
  MessageSquare,
  StickyNote,
  Type as TypeIcon,
  Copy as CopyIcon,
  Users,
} from "lucide-react";
import { relativeTime, cleanCaption } from "@sitepix/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditProjectDialog } from "@/features/projects/components/EditProjectDialog";
import { ProjectActionsMenu } from "@/features/projects/components/ProjectActionsMenu";
import { ProjectChecklists } from "@/features/projects/components/ProjectChecklists";
import { ProjectWorkflows } from "@/features/projects/components/ProjectWorkflows";
import { ProjectTasks, type ProjectTasksHandle } from "@/features/projects/components/ProjectTasks";
import { ProjectDocuments } from "@/features/projects/components/ProjectDocuments";
import { ProjectContributors } from "@/features/projects/components/ProjectContributors";
import { PhotoTagPopoverBody } from "@/features/photos/components/PhotoTagPopoverBody";
import { sharePhotoNative } from "@/lib/native-share";
import { VideoRecorder } from "@/features/photos/components/VideoRecorder";
import { WalkthroughRecorder } from "@/features/photos/components/WalkthroughRecorder";
import { VideoThumbnail } from "@/features/photos/components/VideoThumbnail";
import { VideoPlayerDialog } from "@/features/photos/components/VideoPlayerDialog";
import { TagPhotoDialog } from "@/features/photos/components/TagPhotoDialog";
import { PhotoLightbox } from "@/features/photos/components/PhotoLightbox";
import { TagPill } from "@/features/photos/components/TagPill";
import { ensureGlobalTag } from "@/hooks/use-tag-colors";
import { PhotoAnnotator } from "@/features/photos/components/PhotoAnnotator";
import {
  PhotoCommentsPanel,
  type CommentContributor,
} from "@/features/photos/components/PhotoCommentsPanel";
import { PhotoTasksPanel } from "@/features/photos/components/PhotoTasksPanel";
import { PhotoDetailsPanel } from "@/features/photos/components/PhotoDetailsPanel";
import { getProjectContributors } from "@/lib/teams.functions";
import { applyWatermarkToFile, type BeforeAfterTag, type WatermarkContext } from "@/lib/watermark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

import { SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useProfile } from "@/hooks/use-profile";
import { analyzePhoto, extractPhotoText } from "@/lib/ai.functions";
import {
  createReportFromWalkthrough,
  createWalkthroughSession,
  ensureWalkthroughPhotoLinks,
  finishWalkthroughSession,
  generateWalkthroughReport,
  listProjectWalkthroughs,
  saveWalkthroughPhoto,
  transcribeWalkthrough,
  updateWalkthroughVideoPath,
} from "@/lib/walkthroughs.functions";

import { CameraCapture, compressImageFile } from "@/features/photos/components/CameraCapture";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { toast } from "sonner";
import { BusyOverlay } from "@/components/BusyOverlay";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { extractPhotoMeta, mergePhotoMeta, formatPhotoDateGroup } from "@/lib/photo-exif";
import { LabelPicker } from "@/features/photos/components/LabelPicker";
import { useLabelCatalog, ensureLabel } from "@/hooks/use-label-catalog";
import {
  PhotoBulkActionBar,
  type BulkPhoto,
} from "@/features/photos/components/PhotoBulkActionBar";
import { ProjectTrash } from "@/features/projects/components/ProjectTrash";

const TIER_LABEL: Record<string, string> = {
  starter: "Starter plan",
  pro: "Pro plan",
  team: "Team plan",
};
const VIDEO_MAX_SECONDS: Record<string, number> = { starter: 300, pro: 600, team: 1200 };
const WALKTHROUGH_MAX_SECONDS: Record<string, number> = { pro: 600, team: 1200 };

export type ProjectDetailSearch = {
  camera?: 1;
  walkthrough?: 1;
};

import type { Project, Photo, Report } from "../types";
import { STATUS_DOT } from "../constants";
import { heroInitials } from "../utils/hero-initials";
import { PhotoCarousel } from "../components/PhotoCarousel";

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: "/_app/projects/$projectId" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    isActive,
    isPro,
    isTeam,
    tier,
    canUseWalkthroughs,
    refresh: refreshSubscription,
    bumpAiAnalysesUsed,
  } = useSubscription();
  const [walkthroughUpgradeOpen, setWalkthroughUpgradeOpen] = useState(false);
  const [workflowsUpgradeOpen, setWorkflowsUpgradeOpen] = useState(false);
  const { profile } = useProfile();
  const [project, setProject] = useState<Project | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [walkthroughs, setWalkthroughs] = useState<
    Array<{
      id: string;
      title: string;
      created_at: string;
      duration_seconds: number;
      status: string;
      summary_markdown: string | null;
      share_token: string | null;
      thumb_url: string | null;
      photo_count: number;
      video_path: string | null;
      video_mime_type: string | null;
      video_signed_url: string | null;
    }>
  >([]);
  const [videos, setVideos] = useState<
    Array<{
      id: string;
      storage_path: string;
      created_at: string;
      duration_seconds: number;
      caption: string | null;
      mime_type: string;
      size_bytes: number;
      signed_url: string | null;
    }>
  >([]);
  const [playerVideo, setPlayerVideo] = useState<{
    url: string | null;
    title?: string;
    mime?: string | null;
    emptyMessage?: string;
  } | null>(null);

  const [totalPhotos, setTotalPhotos] = useState(0);
  const [counts, setCounts] = useState({
    tasksOpen: 0,
    tasksTotal: 0,
    checklists: 0,
    reports: 0,
    documents: 0,
    workflows: 0,
  });
  const [trashCount, setTrashCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const tasksRef = useRef<ProjectTasksHandle>(null);
  const analyze = analyzePhoto;
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [sideTab, setSideTab] = useState<"description" | "tasks" | "comments">("comments");
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [ocrCopied, setOcrCopied] = useState(false);
  const runOcr = extractPhotoText;
  const [contributors, setContributors] = useState<CommentContributor[]>([]);
  const fetchContribs = getProjectContributors;
  useEffect(() => {
    let cancelled = false;
    fetchContribs({ data: { projectId } })
      .then((res: any) => {
        if (cancelled) return;
        setContributors(
          (res.contributors ?? []).map((c: any) => ({
            userId: c.userId,
            fullName: c.fullName,
            email: c.email,
            avatarUrl: c.avatarUrl,
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, fetchContribs]);
  const [phaseFilter, setPhaseFilter] = useState<"all" | "before" | "after" | "untagged">("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [tagLogic, setTagLogic] = useState<"and" | "or">("or");
  const [mediaType, setMediaType] = useState<"all" | "photos" | "videos">("all");
  const [photoSize, setPhotoSize] = useState<"sm" | "md" | "lg">("md");
  const [photoView, setPhotoView] = useState<"carousel" | "grid">("grid");
  const [photoLimit, setPhotoLimit] = useState<number>(120);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const toggleSelect = (id: string) =>
    setSelectedPhotoIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clearSelection = () => setSelectedPhotoIds([]);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [mobileWalkId, setMobileWalkId] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [annotatePhotoId, setAnnotatePhotoId] = useState<string | null>(null);
  const [panel, setPanel] = useState<
    null | "tasks" | "checklists" | "walkthroughs" | "reports" | "workflows" | "trash"
  >(null);
  const [creatingReport, setCreatingReport] = useState(false);

  async function generateReport() {
    if (!user) return;
    setCreatingReport(true);
    const title = `${project?.name ?? "Project"} report — ${new Date().toLocaleDateString()}`;
    const { data, error } = await (supabase as any)
      .from("project_reports")
      .insert({
        project_id: projectId,
        created_by: user.id,
        title,
        summary: null,
        photo_ids: photos.map((p) => p.id),
        include_project_info: true,
        allow_download: true,
        photos_per_page: 2,
        cover_enabled: true,
        cover_show_project_name: true,
        cover_show_address: true,
        cover_show_date: true,
        cover_show_author: true,
      })
      .select("id")
      .single();
    setCreatingReport(false);
    if (error || !data) {
      toast.error("Couldn't create report", { description: error?.message });
      return;
    }
    navigate({
      to: "/projects/$projectId/reports/$reportId",
      params: { projectId, reportId: (data as { id: string }).id },
    });
  }
  const fetchWalkthroughs = listProjectWalkthroughs;

  const loadWalkthroughsDirect = async () => {
    const { data: wt, error: wtErr } = await supabase
      .from("walkthroughs" as any)
      .select(
        "id, title, created_at, duration_seconds, status, summary_markdown, share_token, video_path, video_mime_type",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (wtErr) throw wtErr;
    const wtList = ((wt as any[]) ?? []) as Array<any>;
    if (!wtList.length) return [] as Array<any>;

    const ids = wtList.map((w) => w.id);
    const { data: links, error: linkErr } = await supabase
      .from("walkthrough_photos" as any)
      .select("walkthrough_id, photo_id, position")
      .in("walkthrough_id", ids)
      .order("position", { ascending: true });
    if (linkErr)
      console.warn("[walkthrough] direct list photo links failed", linkErr, { projectId });

    const firstByWt = new Map<string, string>();
    const countByWt = new Map<string, number>();
    for (const row of (links as any[]) ?? []) {
      if (!firstByWt.has(row.walkthrough_id)) firstByWt.set(row.walkthrough_id, row.photo_id);
      countByWt.set(row.walkthrough_id, (countByWt.get(row.walkthrough_id) ?? 0) + 1);
    }

    const photoIds = Array.from(new Set(Array.from(firstByWt.values())));
    const phMap = new Map<string, { storage_path: string; image_url: string | null }>();
    const signedPhotoMap: Record<string, string> = {};
    if (photoIds.length) {
      const { data: phRows, error: phErr } = await supabase
        .from("photos")
        .select("id, storage_path, image_url")
        .in("id", photoIds);
      if (phErr)
        console.warn("[walkthrough] direct list thumbnail photos failed", phErr, { projectId });
      for (const p of (phRows as any[]) ?? []) phMap.set(p.id, p);
      const toSign = Array.from(phMap.values())
        .filter((p) => !p.image_url)
        .map((p) => p.storage_path);
      if (toSign.length) {
        const { data: urls, error: signErr } = await supabase.storage
          .from("site-photos")
          .createSignedUrls(toSign, 60 * 60);
        if (signErr)
          console.warn("[walkthrough] direct list thumbnail signing failed", signErr, {
            projectId,
          });
        urls?.forEach((u, i) => {
          if (u.signedUrl) signedPhotoMap[toSign[i]] = u.signedUrl;
        });
      }
    }

    const videoPaths = wtList.map((w) => w.video_path).filter(Boolean) as string[];
    const signedVideoMap: Record<string, string> = {};
    if (videoPaths.length) {
      const { data: urls, error: signErr } = await supabase.storage
        .from("site-videos")
        .createSignedUrls(videoPaths, 60 * 60);
      if (signErr)
        console.warn("[walkthrough] direct list video signing failed", signErr, { projectId });
      urls?.forEach((u, i) => {
        if (u.signedUrl) signedVideoMap[videoPaths[i]] = u.signedUrl;
      });
    }

    return wtList.map((w) => {
      const pid = firstByWt.get(w.id);
      const ph = pid ? phMap.get(pid) : undefined;
      return {
        ...w,
        thumb_url: ph ? (ph.image_url ?? signedPhotoMap[ph.storage_path] ?? null) : null,
        photo_count: countByWt.get(w.id) ?? 0,
        video_signed_url: w.video_path ? (signedVideoMap[w.video_path] ?? null) : null,
      };
    });
  };

  const projectAddress = (p: Project | null) => {
    if (!p) return null;
    const parts = [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean);
    return parts.length ? parts.join(" · ") : (p.location ?? null);
  };
  const watermarkCtx = (p: Project | null): WatermarkContext => ({
    projectName: p?.name ?? null,
    address: projectAddress(p),
    companyName: profile?.company ?? null,
    companyLogoUrl:
      tier === "team" && profile?.watermark_enabled !== false
        ? (profile?.company_logo_url ?? null)
        : null,
  });

  const load = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    const [{ data: p, error: pErr }, { data: ph }, { count }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
      (supabase as any)
        .from("photos")
        .select(
          "id, storage_path, image_url, caption, phase, tags, created_at, taken_at, latitude, longitude, hidden, deleted_at",
        )
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .or("phase.is.null,phase.neq.walkthrough")
        .not("storage_path", "like", "%/walkthroughs/%")
        .order("taken_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(photoLimit),
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .or("phase.is.null,phase.neq.walkthrough")
        .not("storage_path", "like", "%/walkthroughs/%"),
    ]);
    if (pErr || !p) {
      toast.error("Project not found");
      navigate({ to: "/projects" });
      return;
    }
    setProject(p as Project);
    setTotalPhotos(count ?? 0);
    const photoList = ((ph as Photo[]) ?? []).filter(
      (p) => p.phase !== "walkthrough" && !p.storage_path.includes("/walkthroughs/"),
    );
    setPhotos(photoList);

    if (photoList.length > 0) {
      const photoIds = photoList.map((x) => x.id);
      const { data: ar } = await supabase
        .from("ai_analyses")
        .select("id, photo_id, report_text, defects, created_at")
        .in("photo_id", photoIds)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(5);
      setReports((ar as Report[]) ?? []);

      const toSign = photoList.filter((x) => !x.image_url).map((x) => x.storage_path);
      if (toSign.length) {
        const { data: urls } = await supabase.storage
          .from("site-photos")
          .createSignedUrls(toSign, 60 * 60);
        if (urls) {
          const map: Record<string, string> = {};
          urls.forEach((u, i) => {
            if (u.signedUrl) map[toSign[i]] = u.signedUrl;
          });
          setSigned(map);
        }
      }
    } else {
      setReports([]);
    }
    if (user) {
      try {
        const serverWalkthroughs = await fetchWalkthroughs({ data: { projectId } });
        setWalkthroughs(((serverWalkthroughs as any[]) ?? []) as any);
      } catch (wtErr: any) {
        console.error("[walkthrough] load failed", wtErr, { projectId });
        try {
          console.log("[walkthrough] trying direct walkthrough list fallback", { projectId });
          const directWalkthroughs = await loadWalkthroughsDirect();
          setWalkthroughs(directWalkthroughs as any);
        } catch (directWtErr: any) {
          console.error("[walkthrough] direct list fallback failed", directWtErr, { projectId });
          toast.error(
            `Walkthroughs could not load: ${directWtErr?.message ?? wtErr?.message ?? "unknown error"}`,
          );
        }
      }
    } else {
      setWalkthroughs([]);
    }

    // Load saved videos for this project
    const { data: vids } = await supabase
      .from("videos")
      .select("id, storage_path, created_at, duration_seconds, caption, mime_type, size_bytes")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10);
    const vidList = (vids as any[]) ?? [];
    const signedVidMap: Record<string, string> = {};
    if (vidList.length) {
      const paths = vidList.map((v) => v.storage_path);
      const { data: urls } = await supabase.storage
        .from("site-videos")
        .createSignedUrls(paths, 60 * 60);
      if (urls)
        urls.forEach((u, i) => {
          if (u.signedUrl) signedVidMap[paths[i]] = u.signedUrl;
        });
    }
    setVideos(vidList.map((v) => ({ ...v, signed_url: signedVidMap[v.storage_path] ?? null })));

    // Load counts for secondary feature cards (best-effort; ignore errors)
    try {
      const [tasksAll, tasksOpen, chk, rep, docs, wf] = await Promise.all([
        supabase
          .from("tasks" as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
        supabase
          .from("tasks" as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .neq("status", "done"),
        supabase
          .from("project_checklists" as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
        supabase
          .from("project_reports" as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
        supabase
          .from("project_documents" as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
        supabase
          .from("project_workflows" as any)
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId),
      ]);
      setCounts({
        tasksTotal: tasksAll.count ?? 0,
        tasksOpen: tasksOpen.count ?? 0,
        checklists: chk.count ?? 0,
        reports: rep.count ?? 0,
        documents: docs.count ?? 0,
        workflows: wf.count ?? 0,
      });
    } catch {
      /* non-fatal */
    }

    // Trash count for tab badge
    try {
      const { count: trashN } = await (supabase as any)
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .not("deleted_at", "is", null);
      setTrashCount(trashN ?? 0);
    } catch {
      /* non-fatal */
    }

    if (!options?.silent) setLoading(false);
  };

  useEffect(() => {
    void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [projectId, user?.id]);
  useEffect(() => {
    if (photoLimit > 120)
      void load({ silent: true }); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [photoLimit]);

  // Track this project as the most-recently-visited so the global floating
  // camera button shoots into it from anywhere in the app.
  useEffect(() => {
    if (!projectId) return;
    void import("@/hooks/use-last-project").then(({ setLastProjectId }) =>
      setLastProjectId(projectId),
    );
  }, [projectId]);

  // Auto-open the camera when the FAB navigates here with ?camera=1, then
  // clear the flag so a back-nav doesn't re-trigger it.
  const search = useSearch({ from: "/_app/projects/$projectId" });
  useEffect(() => {
    if (search.camera === 1) {
      setCameraOpen(true);
      navigate({
        to: "/projects/$projectId",
        params: { projectId },
        search: { camera: undefined, walkthrough: undefined },
        replace: true,
      });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search.camera]);

  // Auto-open the walkthrough recorder when navigated here with ?walkthrough=1
  // (e.g. from the dashboard's Capture update dialog), then clear the flag.
  useEffect(() => {
    if (search.walkthrough === 1) {
      if (canUseWalkthroughs) void startWalkthrough();
      else setWalkthroughUpgradeOpen(true);
      navigate({
        to: "/projects/$projectId",
        params: { projectId },
        search: { camera: undefined, walkthrough: undefined },
        replace: true,
      });
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search.walkthrough]);

  // Real-time: refresh when photos, videos, or walkthroughs change for this project.
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photos", filter: `project_id=eq.${projectId}` },
        () => {
          void load({ silent: true });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "videos", filter: `project_id=eq.${projectId}` },
        () => {
          void load({ silent: true });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "walkthroughs",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void load({ silent: true });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [projectId]);

  const allPhotoTags = useMemo(
    () => Array.from(new Set(photos.flatMap((p) => p.tags ?? []))).sort(),
    [photos],
  );

  const createPhotoTag = async (raw: string): Promise<string | null> => {
    const t = raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
    if (!t) return null;
    // Make sure the tag exists in the global library so its color is shared everywhere.
    void ensureGlobalTag(t, undefined, user?.id ?? null);
    return t;
  };

  // ---- Project Labels (color-managed, separate from photo tags) --------------
  const labelCatalog = useLabelCatalog();
  const projectLabels = project?.labels ?? [];
  const setProjectLabels = async (next: string[]) => {
    if (!project) return;
    const clean = Array.from(new Set(next.map((s) => s.trim()).filter(Boolean)));
    setProject({ ...project, labels: clean });
    // Ensure any newly named labels exist in the shared catalog with a color.
    for (const name of clean) {
      if (!projectLabels.includes(name)) {
        void ensureLabel(name, null, user?.id ?? "");
      }
    }
    const { error } = await (supabase as any)
      .from("projects")
      .update({ labels: clean })
      .eq("id", project.id);
    if (error) {
      toast.error(error.message);
      void load();
    }
  };

  const togglePhotoTag = async (photoId: string, t: string) => {
    const ph = photos.find((p) => p.id === photoId);
    if (!ph || !project) return;
    const has = (ph.tags ?? []).includes(t);
    const next = has ? (ph.tags ?? []).filter((x) => x !== t) : [...(ph.tags ?? []), t];
    setPhotos((ps) => ps.map((p) => (p.id === photoId ? { ...p, tags: next } : p)));
    // Ensure the global tag exists (and has a remembered color) before linking.
    if (!has) void ensureGlobalTag(t, undefined, user?.id ?? null);
    const { error } = await supabase
      .from("photos")
      .update({ tags: next } as any)
      .eq("id", photoId);
    if (error) {
      toast.error(error.message);
      void load();
      return;
    }

    // Roll up photo tags to project_tags so Home/dashboard tag filters reflect them.
    try {
      const { data: tagRow } = await (supabase as any)
        .from("tags")
        .select("id")
        .eq("name", t)
        .maybeSingle();
      if (!tagRow?.id) return;
      if (!has) {
        // Newly added → ensure project_tags row exists.
        await (supabase as any)
          .from("project_tags")
          .upsert(
            { project_id: project.id, tag_id: tagRow.id, created_by: user?.id },
            { onConflict: "project_id,tag_id", ignoreDuplicates: true },
          );
      } else {
        // Removed → if no other photo in this project still carries the tag, drop it from the project.
        const stillUsed = photos.some((p) => p.id !== photoId && (p.tags ?? []).includes(t));
        if (!stillUsed) {
          await (supabase as any)
            .from("project_tags")
            .delete()
            .eq("project_id", project.id)
            .eq("tag_id", tagRow.id);
        }
      }
    } catch {
      // Non-fatal: photo tag is saved; rollup will re-sync on next load.
    }
  };

  const deletePhoto = async (photo: Photo) => {
    if (
      !window.confirm(
        "Move this photo to Trash?\n\nIt will be permanently deleted after 60 days. You can restore it from the Trash tab any time before then.",
      )
    )
      return;
    const prev = photos;
    setPhotos((ps) => ps.filter((x) => x.id !== photo.id));
    const { error } = await (supabase as any)
      .from("photos")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", photo.id);
    if (error) {
      setPhotos(prev);
      toast.error(error.message);
      return;
    }
    toast.success("Photo moved to Trash");
  };

  const toggleTagFilter = (t: string) =>
    setTagFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));

  const normalizedPhase = (p: Photo): "before" | "after" | "untagged" =>
    p.phase === "before" ? "before" : p.phase === "after" ? "after" : "untagged";

  const filteredPhotos = useMemo(() => {
    const filtered = photos.filter((p) => {
      const ph = normalizedPhase(p);
      const phaseOk = phaseFilter === "all" ? true : ph === phaseFilter;
      if (!phaseOk) return false;
      if (tagFilter.length === 0) return true;
      const pt = p.tags ?? [];
      return tagLogic === "and"
        ? tagFilter.every((t) => pt.includes(t))
        : tagFilter.some((t) => pt.includes(t));
    });
    const sorted = [...filtered].sort((a, b) => {
      const ta = new Date(a.taken_at ?? a.created_at).getTime();
      const tb = new Date(b.taken_at ?? b.created_at).getTime();
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
    return sorted;
  }, [photos, phaseFilter, tagFilter, tagLogic, sortOrder]);

  // Live counts for the current lightbox photo — used for toolbar badges.
  const currentLightboxPhotoId =
    lightboxIndex !== null && filteredPhotos[lightboxIndex]
      ? filteredPhotos[lightboxIndex].id
      : null;
  const [toolCounts, setToolCounts] = useState<{ chats: number; tasks: number }>({
    chats: 0,
    tasks: 0,
  });
  useEffect(() => {
    if (!currentLightboxPhotoId) return;
    let cancelled = false;
    (async () => {
      const [chatsRes, tasksRes] = await Promise.all([
        supabase
          .from("photo_comments" as any)
          .select("id", { count: "exact", head: true })
          .eq("photo_id", currentLightboxPhotoId),
        supabase
          .from("tasks" as any)
          .select("id", { count: "exact", head: true })
          .contains("photo_ids", [currentLightboxPhotoId]),
      ]);
      if (cancelled) return;
      setToolCounts({ chats: chatsRes.count ?? 0, tasks: tasksRes.count ?? 0 });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentLightboxPhotoId, sideTab]);

  const uploadOne = async (
    rawFile: File,
    tag: BeforeAfterTag = null,
    extraTags: string[] = [],
  ): Promise<string | null> => {
    if (!user) return null;
    // Extract EXIF from the ORIGINAL file before watermarking/compression strips it.
    const exif = await extractPhotoMeta(rawFile);
    const meta = mergePhotoMeta(exif, {
      latitude: project?.latitude ?? null,
      longitude: project?.longitude ?? null,
    });
    const tagged = await applyWatermarkToFile(rawFile, { ...watermarkCtx(project), tag });
    const file = await compressImageFile(tagged);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("site-photos")
      .upload(path, file, { contentType: file.type });
    if (upErr) {
      toast.error(upErr.message);
      return null;
    }
    const { data: row, error: insErr } = await supabase
      .from("photos")
      .insert({
        project_id: projectId,
        uploaded_by: user.id,
        storage_path: path,
        size_bytes: file.size,
        caption: file.name,
        phase: tag ?? "untagged",
        tags: extraTags.length ? extraTags : undefined,
        taken_at: meta.taken_at,
        latitude: meta.latitude,
        longitude: meta.longitude,
      } as any)
      .select("id")
      .single();
    if (insErr || !row) {
      toast.error(insErr?.message ?? "Upload failed");
      return null;
    }
    return row.id;
  };

  const onUpload = (files: FileList | null) => {
    if (!files || !user) return;
    const incoming = Array.from(files);
    setPendingFiles(incoming);
  };

  const processPendingWithTag = async (tag: BeforeAfterTag, extraTags: string[] = []) => {
    const incoming = pendingFiles;
    setPendingFiles(null);
    if (!incoming || !user) return;
    setUploading(true);
    try {
      for (const file of incoming) await uploadOne(file, tag, extraTags);
      toast.success(incoming.length > 1 ? `${incoming.length} photos added` : "Photo added");
      await load();
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const onCameraCapture = async (
    file: File,
    opts: { analyze: boolean; tag: BeforeAfterTag; tags?: string[]; description?: string },
  ) => {
    setUploading(true);
    try {
      // Camera already drew watermark on the captured image — don't double-stamp,
      // but still persist the phase tag.
      const photoId = await (async () => {
        if (!user) return null;
        // Camera captures have no EXIF — try device geolocation, fall back to project coords.
        const geo = await new Promise<{ lat: number | null; lng: number | null }>((resolve) => {
          if (typeof navigator === "undefined" || !navigator.geolocation) {
            resolve({ lat: null, lng: null });
            return;
          }
          const t = setTimeout(() => resolve({ lat: null, lng: null }), 2500);
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(t);
              resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            },
            () => {
              clearTimeout(t);
              resolve({ lat: null, lng: null });
            },
            { enableHighAccuracy: false, timeout: 2000, maximumAge: 60_000 },
          );
        });
        const file2 = await compressImageFile(file);
        const ext = (file2.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("site-photos")
          .upload(path, file2, { contentType: file2.type });
        if (upErr) {
          toast.error(upErr.message);
          return null;
        }
        const { data: row, error: insErr } = await supabase
          .from("photos")
          .insert({
            project_id: projectId,
            uploaded_by: user.id,
            storage_path: path,
            size_bytes: file2.size,
            caption:
              opts.description && opts.description.trim() ? opts.description.trim() : file2.name,
            phase: opts.tag ?? "untagged",
            tags: opts.tags && opts.tags.length ? opts.tags : undefined,
            taken_at: new Date().toISOString(),
            latitude: geo.lat ?? project?.latitude ?? null,
            longitude: geo.lng ?? project?.longitude ?? null,
          } as any)
          .select("id")
          .single();
        if (insErr || !row) {
          toast.error(insErr?.message ?? "Upload failed");
          return null;
        }
        return row.id;
      })();
      if (!photoId) return;
      toast.success("Photo saved");
      if (opts.analyze && isActive) {
        toast.message("Analyzing photo…", { description: "This takes 10–25 seconds." });
        try {
          await analyze({ data: { photoId } });
          bumpAiAnalysesUsed();
          void refreshSubscription();
          toast.success("AI analysis complete");
        } catch (e: any) {
          toast.error(e?.message ?? "AI analysis failed");
        }
      }
      await load();
    } finally {
      setUploading(false);
    }
  };

  const onVideoSave = async (file: File, opts: { durationSeconds: number; transcript: string }) => {
    if (!user) return;
    setUploading(true);
    try {
      const ext = file.type.includes("mp4") ? "mp4" : "webm";
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("site-videos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const { error: insErr } = await supabase.from("videos").insert({
        project_id: projectId,
        uploaded_by: user.id,
        storage_path: path,
        size_bytes: file.size,
        duration_seconds: opts.durationSeconds,
        transcript: opts.transcript || null,
        caption: file.name,
        mime_type: file.type,
      } as any);
      if (insErr) {
        toast.error(insErr.message);
        return;
      }
      toast.success("Video saved to project");
      await load();
    } finally {
      setUploading(false);
    }
  };

  // --- Walkthrough Note ---
  const walkRef = useRef<{ id: string; created_at?: string | null; title?: string | null } | null>(
    null,
  );
  const genReport = generateWalkthroughReport;
  const transcribeWalk = transcribeWalkthrough;
  const buildReportFromWalk = createReportFromWalkthrough;
  const createWalkSession = createWalkthroughSession;

  const saveWalkPhoto = saveWalkthroughPhoto;
  const finishWalkSession = finishWalkthroughSession;
  const updateWalkVideo = updateWalkthroughVideoPath;
  const ensureWalkLinks = ensureWalkthroughPhotoLinks;

  const ensureWalkthroughRow = async (
    reason: "start" | "capture" | "finish",
  ): Promise<string | null> => {
    if (!user) return null;
    if (walkRef.current?.id) {
      return walkRef.current.id;
    }
    const title = `${project?.name ?? "Walkthrough"} — ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    const commitCreated = (created: { id: string; createdAt?: string | null }) => {
      walkRef.current = {
        id: created.id,
        created_at: created.createdAt ?? new Date().toISOString(),
        title,
      };
      setWalkthroughs((prev) =>
        prev.some((w) => w.id === created.id)
          ? prev
          : ([
              {
                id: created.id,
                title,
                created_at: created.createdAt ?? new Date().toISOString(),
                duration_seconds: 0,
                status: "recording",
                summary_markdown: null,
                share_token: null,
                thumb_url: null,
                photo_count: 0,
                video_path: null,
                video_mime_type: null,
                video_signed_url: null,
              },
              ...prev,
            ] as any),
      );
    };
    const createDirectly = async () => {
      console.warn("[walkthrough] trying direct DB record fallback", { projectId, reason });
      const { data: fallback, error: fallbackErr } = await supabase
        .from("walkthroughs" as any)
        .insert({ project_id: projectId, created_by: user.id, title, status: "recording" } as any)
        .select("id, created_at")
        .single();
      if (fallbackErr || !fallback) throw fallbackErr ?? new Error("No walkthrough id returned");
      return {
        id: (fallback as any).id as string,
        createdAt: (fallback as any).created_at as string | null,
      };
    };
    console.log("[walkthrough] Creating DB record", { projectId, userId: user.id, reason });
    try {
      let created = await createWalkSession({ data: { projectId, title } });
      if (!created?.id) {
        console.warn("[walkthrough] server create returned no id", { projectId, reason });
        created = (await createDirectly()) as any;
      }
      if (!created?.id) throw new Error("No walkthrough id returned");
      commitCreated({ id: created.id, createdAt: (created as any).createdAt });
      console.log(`[walkthrough] Creating DB record - Success - ID: ${created.id}`);
      console.log("[walkthrough] row created", { wid: created.id, projectId, reason });
      return created.id;
    } catch (error: any) {
      console.error("[walkthrough] row insert failed", error, {
        projectId,
        userId: user.id,
        reason,
      });
      try {
        const created = await createDirectly();
        commitCreated(created);
        console.log(`[walkthrough] Creating DB record - Success - ID: ${created.id}`);
        console.log("[walkthrough] row created", {
          wid: created.id,
          projectId,
          reason,
          fallback: "direct",
        });
        return created.id;
      } catch (fallbackError: any) {
        console.error("[walkthrough] direct row insert fallback failed", fallbackError, {
          projectId,
          userId: user.id,
          reason,
        });
        toast.error(
          fallbackError?.message ??
            error?.message ??
            "Could not start walkthrough — check that you're signed in and have access to this project.",
        );
      }
      return null;
    }
  };

  const startWalkthrough = async () => {
    if (!user) return;
    console.log("[walkthrough] Starting...");
    if (walkRef.current?.id) {
      console.log("[walkthrough] reopening active recorder", { wid: walkRef.current.id });
      setWalkthroughOpen(true);
      setPanel("walkthroughs");
      return;
    }
    const wid = await ensureWalkthroughRow("start");
    if (!wid) return;
    setWalkthroughOpen(true);
    setPanel("walkthroughs");
  };

  const onWalkthroughCapture = async (
    file: File,
    meta: { offsetSeconds: number; position: number },
  ): Promise<string | null> => {
    if (!user) return null;
    const wid = await ensureWalkthroughRow("capture");
    if (!wid) {
      console.error("[walkthrough] photo capture blocked because no walkthrough row exists", {
        projectId,
        userId: user.id,
      });
      toast.error(
        "Walkthrough did not initialize. Close this recorder and start a new walkthrough from the Walkthroughs tile.",
      );
      return null;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${user.id}/${projectId}/walkthroughs/${wid}/${crypto.randomUUID()}.${ext}`;
    console.log("[walkthrough] uploading captured photo", {
      wid,
      offsetSeconds: meta.offsetSeconds,
      position: meta.position,
      bytes: file.size,
    });
    const { error: upErr } = await supabase.storage
      .from("site-photos")
      .upload(path, file, { contentType: file.type });
    if (upErr) {
      console.error("[walkthrough] photo upload failed", upErr);
      toast.error(upErr.message);
      return null;
    }
    let photoId: string | null = null;
    try {
      console.log("[walkthrough] Linking photos", {
        wid,
        position: meta.position,
        offsetSeconds: meta.offsetSeconds,
      });
      const saved = await saveWalkPhoto({
        data: {
          projectId,
          walkthroughId: wid,
          storagePath: path,
          sizeBytes: file.size,
          caption: file.name,
          offsetSeconds: meta.offsetSeconds,
          position: meta.position,
          takenAt: new Date().toISOString(),
          latitude: project?.latitude ?? null,
          longitude: project?.longitude ?? null,
        },
      });
      photoId = saved?.photoId ?? null;
    } catch (insErr: any) {
      console.error("[walkthrough] photo row/link save failed", insErr);
      console.warn("[walkthrough] trying direct photo/link fallback", { wid, path });
      try {
        const { data: row, error: photoErr } = await supabase
          .from("photos")
          .insert({
            project_id: projectId,
            uploaded_by: user.id,
            storage_path: path,
            size_bytes: file.size,
            caption: file.name,
            phase: "walkthrough",
            tags: [],
            taken_at: new Date().toISOString(),
            latitude: project?.latitude ?? null,
            longitude: project?.longitude ?? null,
          } as any)
          .select("id")
          .single();
        if (photoErr || !row) throw photoErr ?? new Error("Photo row was not created");
        photoId = (row as any).id as string;
        const { error: linkErr } = await supabase.from("walkthrough_photos" as any).upsert(
          {
            walkthrough_id: wid,
            photo_id: photoId,
            created_by: user.id,
            offset_seconds: meta.offsetSeconds,
            spoken_note: null,
            position: meta.position,
          } as any,
          { onConflict: "walkthrough_id,photo_id", ignoreDuplicates: true },
        );
        if (linkErr) {
          console.error(
            "[walkthrough] direct photo link fallback failed; keeping hidden photo for finish recovery",
            linkErr,
            { wid, photoId },
          );
          await supabase
            .from("photos")
            .update({ phase: "walkthrough" } as any)
            .eq("id", photoId);
        }
      } catch (fallbackErr: any) {
        console.error("[walkthrough] direct photo/link fallback failed", fallbackErr);
        void supabase.storage.from("site-photos").remove([path]);
        toast.error(
          fallbackErr?.message ??
            insErr?.message ??
            "Captured photo could not be linked to the walkthrough",
        );
        return null;
      }
    }
    if (!photoId) {
      console.error("[walkthrough] photo save returned no id", { wid, path });
      void supabase.storage.from("site-photos").remove([path]);
      toast.error("Captured photo could not be linked to the walkthrough");
      return null;
    }

    console.log("[walkthrough] captured photo linked", {
      wid,
      photoId,
      offsetSeconds: meta.offsetSeconds,
      position: meta.position,
    });
    setWalkthroughs((prev) =>
      prev.map((w) =>
        w.id === wid
          ? {
              ...w,
              photo_count: Math.max((w.photo_count ?? 0) + 1, meta.position + 1),
              thumb_url: w.thumb_url,
            }
          : w,
      ),
    );
    return photoId;
  };

  const onWalkthroughFinish = async (data: {
    mediaBlob: Blob | null;
    mediaMimeType: string | null;
    durationSeconds: number;
    photos: Array<{ photoId: string; offsetSeconds: number }>;
    audioBlob?: Blob | null;
    audioMimeType?: string | null;
    liveTranscript: string;
  }) => {
    if (!user) {
      console.error("[walkthrough] finish called with no user");
      toast.error("Couldn't save walkthrough — session expired. Please sign in again.");
      throw new Error("Missing user");
    }
    const wid = await ensureWalkthroughRow("finish");
    if (!wid) {
      console.error("[walkthrough] finish called with no walkthrough id or user", {
        wid,
        user: !!user,
      });
      toast.error("Couldn't save walkthrough — session expired. Please sign in again.");
      throw new Error("Missing walkthrough id or user");
    }
    const liveTranscript = (data.liveTranscript ?? "").trim();
    const durationSeconds = Math.max(1, Math.round(data.durationSeconds || 1));
    console.log("[walkthrough] Recording stopped", { wid });
    console.log("[walkthrough] finishing", {
      wid,
      duration: durationSeconds,
      photos: data.photos.length,
      transcriptChars: liveTranscript.length,
      hasMedia: !!data.mediaBlob,
      mediaBytes: data.mediaBlob?.size ?? 0,
    });

    const paragraphize = (raw: string) => {
      const cleaned = raw.replace(/\s+/g, " ").trim();
      if (!cleaned) return "";
      const sentences = cleaned
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“‘(])/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentences.length <= 1) return cleaned;
      const paragraphs: string[] = [];
      for (let i = 0; i < sentences.length; i += 3) {
        paragraphs.push(sentences.slice(i, i + 3).join(" "));
      }
      return paragraphs.join("\n\n");
    };

    const buildClientFallbackReport = () => {
      const lines = [`# ${project?.name ?? "Walkthrough Note"}`];
      const paragraphs = paragraphize(liveTranscript);
      if (paragraphs) lines.push("", "## Summary", "", paragraphs);
      if (data.photos.length) {
        lines.push("", "## Photos");
        data.photos.forEach((p, i) => {
          const m = Math.floor(Math.max(0, p.offsetSeconds) / 60);
          const s = Math.max(0, p.offsetSeconds) % 60;
          lines.push(
            "",
            `### Photo ${i + 1} · ${m}:${s.toString().padStart(2, "0")}`,
            "",
            `![Photo ${i + 1}](photo:${p.photoId})`,
          );
        });
      }
      if (!paragraphs && !data.photos.length) {
        lines.push(
          "",
          "## Notes",
          "",
          "Recording saved. No transcript or walkthrough photos were captured.",
        );
      }
      return lines.join("\n").trim();
    };

    const directLinkPhotos = async () => {
      if (!data.photos.length) return 0;
      const rows = data.photos.map((p, position) => ({
        walkthrough_id: wid,
        photo_id: p.photoId,
        created_by: user.id,
        offset_seconds: p.offsetSeconds,
        spoken_note: null,
        position,
      }));
      const { error: linkErr } = await supabase
        .from("walkthrough_photos" as any)
        .upsert(rows as any, { onConflict: "walkthrough_id,photo_id", ignoreDuplicates: true });
      if (linkErr) throw linkErr;
      await supabase
        .from("photos")
        .update({ phase: "walkthrough" } as any)
        .in(
          "id",
          data.photos.map((p) => p.photoId),
        );
      return rows.length;
    };

    const blobToBase64 = async (blob: Blob) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("Could not read recording"));
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(blob);
      });
      return dataUrl.split(",")[1] ?? "";
    };

    // CRITICAL: commit the walkthrough row BEFORE closing the recorder, so
    // any RLS / network failure surfaces instead of being silently swallowed
    // while the dialog disappears.
    if (data.photos.length) {
      console.log("[walkthrough] Linking photos", {
        wid,
        photos: data.photos.length,
        stage: "pre-finish",
      });
      try {
        await ensureWalkLinks({
          data: {
            walkthroughId: wid,
            photos: data.photos.map((p, position) => ({ ...p, position })),
          },
        });
      } catch (linkErr: any) {
        console.error("[walkthrough] pre-finish photo link verification failed", linkErr);
        try {
          const linkedCount = await directLinkPhotos();
          console.log("[walkthrough] direct pre-finish photo links saved", { wid, linkedCount });
        } catch (directLinkErr: any) {
          console.error(
            "[walkthrough] direct pre-finish photo link fallback failed",
            directLinkErr,
          );
          toast.warning(
            `Walkthrough saved, but photo linking may be incomplete: ${directLinkErr?.message ?? linkErr?.message ?? "unknown error"}`,
          );
        }
      }
    } else {
      console.log("[walkthrough] Linking photos", {
        wid,
        photos: 0,
        skipped: true,
        stage: "pre-finish",
      });
    }

    try {
      await finishWalkSession({ data: { walkthroughId: wid, durationSeconds, liveTranscript } });
      console.log("[walkthrough] finish row update acknowledged", { wid });
      setWalkthroughs((prev) =>
        prev.map((w) =>
          w.id === wid
            ? {
                ...w,
                duration_seconds: durationSeconds,
                status: "ready",
                summary_markdown: w.summary_markdown ?? buildClientFallbackReport(),
                photo_count: Math.max(w.photo_count ?? 0, data.photos.length),
              }
            : w,
        ),
      );
    } catch (updErr: any) {
      console.error("[walkthrough] update failed", updErr);
      console.warn("[walkthrough] trying direct finish fallback", { wid });
      try {
        const fallbackReport = buildClientFallbackReport();
        const { error: directErr } = await supabase
          .from("walkthroughs" as any)
          .update({
            duration_seconds: durationSeconds,
            ended_at: new Date().toISOString(),
            status: "ready",
            transcript: liveTranscript || null,
            summary_markdown: fallbackReport,
          } as any)
          .eq("id", wid);
        if (directErr) throw directErr;
        console.log("[walkthrough] direct finish fallback saved", { wid });
        setWalkthroughs((prev) =>
          prev.map((w) =>
            w.id === wid
              ? {
                  ...w,
                  duration_seconds: durationSeconds,
                  status: "ready",
                  summary_markdown: fallbackReport,
                  photo_count: Math.max(w.photo_count ?? 0, data.photos.length),
                }
              : w,
          ),
        );
      } catch (directErr: any) {
        console.error("[walkthrough] direct finish fallback failed", directErr);
        setWalkthroughs((prev) =>
          prev.map((w) =>
            w.id === wid
              ? {
                  ...w,
                  duration_seconds: durationSeconds,
                  status: "ready",
                  summary_markdown: w.summary_markdown ?? buildClientFallbackReport(),
                  photo_count: Math.max(w.photo_count ?? 0, data.photos.length),
                }
              : w,
          ),
        );
        toast.error(
          `Walkthrough is visible locally, but the final save still failed: ${directErr?.message ?? updErr?.message ?? "unknown error"}`,
        );
      }
    }

    let videoPath: string | null = null;
    let signedVideoUrl: string | null = null;
    if (data.mediaBlob && data.mediaMimeType) {
      try {
        console.log("[walkthrough] Uploading video", {
          wid,
          stage: "before-close",
          bytes: data.mediaBlob.size,
          mime: data.mediaMimeType,
        });
        const ext = data.mediaMimeType.includes("mp4") ? "mp4" : "webm";
        videoPath = `${user.id}/${projectId}/walkthroughs/${wid}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("site-videos")
          .upload(videoPath, data.mediaBlob, { contentType: data.mediaMimeType, upsert: true });
        if (upErr) throw upErr;

        const { error: directVideoErr } = await supabase
          .from("walkthroughs" as any)
          .update({ video_path: videoPath, video_mime_type: data.mediaMimeType } as any)
          .eq("id", wid);
        if (directVideoErr)
          console.warn(
            "[walkthrough] direct video_path update failed; trying server update",
            directVideoErr,
            { wid, videoPath },
          );
        let serverVideoSaved = false;
        try {
          await updateWalkVideo({
            data: { walkthroughId: wid, videoPath, videoMimeType: data.mediaMimeType },
          });
          serverVideoSaved = true;
        } catch (serverVideoErr) {
          console.warn(
            "[walkthrough] video_path server update failed after direct save",
            serverVideoErr,
            { wid, videoPath },
          );
        }
        if (directVideoErr && !serverVideoSaved) throw directVideoErr;

        const { data: signedVideo, error: signErr } = await supabase.storage
          .from("site-videos")
          .createSignedUrl(videoPath, 60 * 60);
        if (signErr)
          console.warn("[walkthrough] immediate video signing failed", signErr, { wid, videoPath });
        signedVideoUrl = signedVideo?.signedUrl ?? null;
        setWalkthroughs((prev) =>
          prev.map((w) =>
            w.id === wid
              ? {
                  ...w,
                  video_path: videoPath,
                  video_mime_type: data.mediaMimeType,
                  video_signed_url: signedVideoUrl,
                }
              : w,
          ),
        );
        console.log("[walkthrough] video uploaded and linked", {
          wid,
          videoPath,
          hasSignedUrl: !!signedVideoUrl,
        });
      } catch (videoErr: any) {
        console.error("[walkthrough] video upload/link failed before close", videoErr, { wid });
        toast.warning(
          `Walkthrough card is saved, but video upload failed: ${videoErr?.message ?? "unknown error"}`,
        );
        videoPath = null;
        signedVideoUrl = null;
      }
    } else {
      console.log("[walkthrough] Uploading video", {
        wid,
        skipped: true,
        reason: "no media blob",
        stage: "before-close",
      });
    }

    if (data.photos.length) {
      console.log("[walkthrough] Linking photos", {
        wid,
        photos: data.photos.length,
        stage: "post-finish",
      });
      try {
        await ensureWalkLinks({
          data: {
            walkthroughId: wid,
            photos: data.photos.map((p, position) => ({ ...p, position })),
          },
        });
      } catch (linkErr: any) {
        console.error("[walkthrough] final photo link verification failed", linkErr);
        try {
          const linkedCount = await directLinkPhotos();
          console.log("[walkthrough] direct final photo links saved", { wid, linkedCount });
        } catch (directLinkErr: any) {
          console.error("[walkthrough] direct final photo link fallback failed", directLinkErr);
          toast.warning(
            `Saved walkthrough but couldn't verify photo links: ${directLinkErr?.message ?? linkErr?.message ?? "unknown error"}`,
          );
        }
      }
    }

    // Row is durably saved. Now we close the recorder and run the rest in
    // the background; the project list flips via realtime or the load() below.
    setWalkthroughOpen(false);
    walkRef.current = null;
    toast.success(
      "Walkthrough saved — report is visible and will keep polishing in the background",
    );
    void load({ silent: true });

    void (async () => {
      const transcriptionBlob =
        data.audioBlob && data.audioMimeType ? data.audioBlob : data.mediaBlob;
      const transcriptionMime =
        data.audioBlob && data.audioMimeType ? data.audioMimeType : data.mediaMimeType;
      if (
        transcriptionBlob &&
        transcriptionMime &&
        transcriptionBlob.size > 0 &&
        transcriptionBlob.size <= 12_500_000
      ) {
        try {
          console.log("[walkthrough] Transcribing recording", {
            wid,
            bytes: transcriptionBlob.size,
            mime: transcriptionMime,
            source: data.audioBlob ? "audio-only" : "video",
          });
          const audioBase64 = await blobToBase64(transcriptionBlob);
          const transcription = await transcribeWalk({
            data: { walkthroughId: wid, audioBase64, mimeType: transcriptionMime },
          });
          console.log("[walkthrough] Transcribing recording complete", {
            wid,
            transcriptChars: transcription?.transcript?.length ?? 0,
          });
          if (
            !transcription?.transcript?.trim() &&
            data.audioBlob &&
            data.mediaBlob &&
            data.mediaMimeType &&
            data.mediaBlob.size <= 12_500_000
          ) {
            console.log(
              "[walkthrough] Audio sidecar had no transcript; retrying transcription from saved video",
              { wid, bytes: data.mediaBlob.size, mime: data.mediaMimeType },
            );
            const videoBase64 = await blobToBase64(data.mediaBlob);
            const videoTranscription = await transcribeWalk({
              data: { walkthroughId: wid, audioBase64: videoBase64, mimeType: data.mediaMimeType },
            });
            console.log("[walkthrough] Video transcription fallback complete", {
              wid,
              transcriptChars: videoTranscription?.transcript?.length ?? 0,
            });
          }
          void load({ silent: true });
        } catch (e) {
          console.warn(
            "[walkthrough] server transcription failed; keeping live transcript/fallback",
            e,
            { wid },
          );
          if (
            data.audioBlob &&
            data.mediaBlob &&
            data.mediaMimeType &&
            data.mediaBlob.size <= 12_500_000
          ) {
            try {
              console.log(
                "[walkthrough] Retrying transcription from saved video after audio sidecar failure",
                { wid, bytes: data.mediaBlob.size, mime: data.mediaMimeType },
              );
              const videoBase64 = await blobToBase64(data.mediaBlob);
              const videoTranscription = await transcribeWalk({
                data: {
                  walkthroughId: wid,
                  audioBase64: videoBase64,
                  mimeType: data.mediaMimeType,
                },
              });
              console.log("[walkthrough] Video transcription retry complete", {
                wid,
                transcriptChars: videoTranscription?.transcript?.length ?? 0,
              });
            } catch (videoErr) {
              console.warn("[walkthrough] video transcription fallback failed", videoErr, { wid });
            }
          }
          void load({ silent: true });
        }
      } else {
        console.log("[walkthrough] Transcribing recording", {
          wid,
          skipped: true,
          reason:
            !transcriptionBlob || !transcriptionMime
              ? "no recording blob"
              : "recording too large for inline transcription",
          bytes: transcriptionBlob?.size ?? 0,
        });
      }

      // 2) Generate the report. The live Android transcript is already saved
      // before this point, so report generation can fail without hiding the
      // walkthrough card the user just created.
      try {
        console.log("[walkthrough] Generating report", { wid });
        await genReport({ data: { walkthroughId: wid } });
        console.log(`[walkthrough] Success - ID: ${wid}`);
        toast.success("Walkthrough report is ready");
        void load({ silent: true });
      } catch (e: any) {
        console.error("[walkthrough] report generation failed", e);
        toast.warning(
          `Fallback report is visible; AI polishing failed: ${e?.message ?? "unknown error"}`,
        );
      }

      // 3) Automatically build a full structured Project Report (Documents /
      // Reports section) from the transcript + photos, so the user gets a
      // client-ready, PDF-exportable report without opening the manual builder.
      try {
        console.log("[walkthrough→report] Creating auto project report", { wid });
        const built = await buildReportFromWalk({ data: { walkthroughId: wid } });
        if (built?.reportId) {
          if (built.alreadyExisted) {
            toast.message("Walkthrough report already exists in Reports");
          } else {
            toast.success("Auto report saved to Reports", {
              action: {
                label: "Open",
                onClick: () =>
                  navigate({
                    to: "/projects/$projectId/reports/$reportId",
                    params: { projectId, reportId: built.reportId },
                  }),
              },
            });
          }
        }
      } catch (e: any) {
        console.error("[walkthrough→report] auto project report failed", e);
        toast.warning(`Auto project report failed: ${e?.message ?? "unknown error"}`);
      }
    })();
  };

  const findStoredWalkthroughVideo = async (walkthroughId: string) => {
    if (!user) return { path: null as string | null, mime: null as string | null };
    const prefix = `${user.id}/${projectId}/walkthroughs`;
    try {
      const { data: objects, error } = await supabase.storage
        .from("site-videos")
        .list(prefix, { limit: 20, search: walkthroughId });
      if (error) {
        console.warn("[walkthrough] stored video lookup failed", error, {
          wid: walkthroughId,
          prefix,
        });
        return { path: null, mime: null };
      }
      const object = (objects ?? []).find(
        (item) =>
          item.name === `${walkthroughId}.webm` ||
          item.name === `${walkthroughId}.mp4` ||
          item.name.startsWith(`${walkthroughId}.`),
      );
      if (!object) return { path: null, mime: null };
      const path = `${prefix}/${object.name}`;
      const mime = object.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/webm";
      console.log("[walkthrough] recovered video path from storage", {
        wid: walkthroughId,
        path,
        mime,
      });
      try {
        await updateWalkVideo({ data: { walkthroughId, videoPath: path, videoMimeType: mime } });
      } catch (updateErr) {
        console.warn("[walkthrough] recovered video path DB update failed", updateErr, {
          wid: walkthroughId,
          path,
        });
      }
      return { path, mime };
    } catch (lookupErr) {
      console.warn("[walkthrough] stored video lookup threw", lookupErr, {
        wid: walkthroughId,
        prefix,
      });
      return { path: null, mime: null };
    }
  };

  const openWalkthroughVideo = async (w: (typeof walkthroughs)[number]) => {
    console.log("[walkthrough] video thumbnail clicked", {
      wid: w.id,
      hasSignedUrl: !!w.video_signed_url,
      hasVideoPath: !!w.video_path,
      status: w.status,
    });
    const title = w.title || "Walkthrough";

    // Fast path: we already have a signed URL cached.
    if (w.video_signed_url) {
      setPlayerVideo({ url: w.video_signed_url, title, mime: w.video_mime_type });
      console.log("[walkthrough] video player opened", { wid: w.id, source: "signed-url" });
      return;
    }

    // Open the player immediately with a loading state — never with the
    // misleading "still processing" copy.
    setPlayerVideo({
      url: null,
      title,
      mime: w.video_mime_type,
      emptyMessage: "Loading walkthrough video…",
    });

    // Always re-check the DB row: the finish flow may have written the
    // video_path after this list was loaded, or a background job may have
    // filled it in. This eliminates the stale "still processing" state.
    let videoPath = w.video_path;
    let videoMime = w.video_mime_type;
    let freshStatus = w.status;
    try {
      const { data: fresh } = await supabase
        .from("walkthroughs" as any)
        .select("video_path, video_mime_type, status")
        .eq("id", w.id)
        .maybeSingle();
      if (fresh && (fresh as any).status) freshStatus = (fresh as any).status;
      if (fresh && (fresh as any).video_path) {
        videoPath = (fresh as any).video_path;
        videoMime = (fresh as any).video_mime_type ?? videoMime;
        setWalkthroughs((prev) =>
          prev.map((item) =>
            item.id === w.id
              ? { ...item, video_path: videoPath, video_mime_type: videoMime }
              : item,
          ),
        );
      }
    } catch (refreshErr) {
      console.warn("[walkthrough] fresh row lookup failed", refreshErr, { wid: w.id });
    }

    if (!videoPath) {
      const recovered = await findStoredWalkthroughVideo(w.id);
      if (recovered.path) {
        videoPath = recovered.path;
        videoMime = recovered.mime ?? videoMime;
        setWalkthroughs((prev) =>
          prev.map((item) =>
            item.id === w.id
              ? { ...item, video_path: videoPath, video_mime_type: videoMime }
              : item,
          ),
        );
      }
    }

    if (!videoPath) {
      const stillProcessing = freshStatus === "recording" || freshStatus === "generating";
      setPlayerVideo({
        url: null,
        title,
        mime: videoMime,
        emptyMessage: stillProcessing
          ? "Walkthrough video is still processing. It will play here as soon as it finishes uploading."
          : "The report is ready, but no playable video file is attached to this walkthrough yet.",
      });
      return;
    }

    try {
      const { data: signedVideo, error: signErr } = await supabase.storage
        .from("site-videos")
        .createSignedUrl(videoPath, 60 * 60);
      if (signErr || !signedVideo?.signedUrl)
        throw signErr ?? new Error("No signed video URL returned");
      setWalkthroughs((prev) =>
        prev.map((item) =>
          item.id === w.id ? { ...item, video_signed_url: signedVideo.signedUrl } : item,
        ),
      );
      setPlayerVideo({ url: signedVideo.signedUrl, title, mime: videoMime });
      console.log("[walkthrough] video player opened", { wid: w.id, source: "fresh-sign" });
    } catch (e: any) {
      console.error("[walkthrough] video signing/open failed", e, { wid: w.id, videoPath });
      setPlayerVideo({
        url: null,
        title,
        mime: videoMime,
        emptyMessage: "Could not load this walkthrough video yet. Please try again in a moment.",
      });
      toast.error(e?.message ?? "Could not open walkthrough video yet");
    }
  };

  /** User dismissed the recorder without finishing — drop the empty walkthrough
   *  so the project list doesn't accumulate ghost "Recording" tiles. */
  const onWalkthroughClose = async () => {
    const wid = walkRef.current?.id;
    setWalkthroughOpen(false);
    if (wid && user) {
      console.log("[walkthrough] closing unfinished walkthrough", { wid });
      const { data: linked } = await supabase
        .from("walkthrough_photos" as any)
        .select("photo_id")
        .eq("walkthrough_id", wid);
      const linkedPhotoIds = ((linked as Array<{ photo_id: string }> | null) ?? []).map(
        (x) => x.photo_id,
      );
      const { data: orphanPhotos } = await supabase
        .from("photos")
        .select("id, created_at, taken_at")
        .eq("project_id", projectId)
        .eq("uploaded_by", user.id)
        .like("storage_path", `%/walkthroughs/${wid}/%`)
        .order("created_at", { ascending: true });
      const orphanRows =
        (orphanPhotos as Array<{
          id: string;
          created_at: string;
          taken_at: string | null;
        }> | null) ?? [];
      if (linkedPhotoIds.length || orphanRows.length) {
        console.log("[walkthrough] close preserved walkthrough with captured photos", {
          wid,
          linked: linkedPhotoIds.length,
          orphaned: orphanRows.length,
        });
        if (orphanRows.length) {
          console.log("[walkthrough] Linking photos", {
            wid,
            photos: orphanRows.length,
            stage: "close-recovery",
          });
          const startMs = new Date(
            orphanRows[0]?.taken_at ?? orphanRows[0]?.created_at ?? Date.now(),
          ).getTime();
          await supabase.from("walkthrough_photos" as any).upsert(
            orphanRows.map((p, position) => ({
              walkthrough_id: wid,
              photo_id: p.id,
              created_by: user.id,
              offset_seconds: Math.max(
                0,
                Math.round((new Date(p.taken_at ?? p.created_at).getTime() - startMs) / 1000),
              ),
              spoken_note: null,
              position: linkedPhotoIds.length + position,
            })) as any,
            { onConflict: "walkthrough_id,photo_id", ignoreDuplicates: true },
          );
          await supabase
            .from("photos")
            .update({ phase: "walkthrough" } as any)
            .in(
              "id",
              orphanRows.map((p) => p.id),
            );
        }
        const allPhotoIds = [...linkedPhotoIds, ...orphanRows.map((p) => p.id)];
        const summary = allPhotoIds.length
          ? [
              `# ${project?.name ?? "Walkthrough Note"}`,
              "",
              "## Photos",
              ...allPhotoIds.flatMap((photoId, i) => [
                "",
                `### Photo ${i + 1}`,
                "",
                `![Photo ${i + 1}](photo:${photoId})`,
              ]),
            ].join("\n")
          : null;
        await supabase
          .from("walkthroughs" as any)
          .update({ status: "ready", summary_markdown: summary } as any)
          .eq("id", wid)
          .eq("status", "recording");
        walkRef.current = null;
        await load();
        return;
      }
      if (linkedPhotoIds.length) {
        const { data: linkedPhotos } = await supabase
          .from("photos")
          .select("id, storage_path")
          .in("id", linkedPhotoIds);
        await supabase.from("photos").delete().in("id", linkedPhotoIds);
        const paths = ((linkedPhotos as Array<{ storage_path: string }> | null) ?? [])
          .map((p) => p.storage_path)
          .filter(Boolean);
        if (paths.length) void supabase.storage.from("site-photos").remove(paths);
      }
      await supabase
        .from("walkthroughs" as any)
        .delete()
        .eq("id", wid)
        .eq("status", "recording");
      walkRef.current = null;
      await load();
    }
  };

  const { pull, refreshing, indicatorStyle } = usePullToRefresh({ onRefresh: load });

  if (loading) {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!project) return null;

  const photoSrc = (p: Photo) => p.image_url ?? signed[p.storage_path] ?? "";

  // (AI report generation lives in the global sidebar, not this page.)

  // Full-page panel view — replaces the project page when a tab is opened.
  // Walkthroughs, Checklists, Documents, Workflows, and Tasks render inline instead (alongside the hero + tab nav), see below.
  if (
    panel &&
    panel !== "walkthroughs" &&
    panel !== "checklists" &&
    panel !== "reports" &&
    panel !== "workflows" &&
    panel !== "tasks"
  ) {
    const panelTitle = panel === "trash" ? "Trash" : "";
    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
          <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanel(null)}
              className="-ml-2 h-9 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to {project.name}
            </Button>
            <div className="truncate text-sm font-semibold">{panelTitle}</div>
            <div className="w-24" />
          </div>
        </div>
        <div className="container mx-auto max-w-6xl px-4 py-8 md:py-10 pb-32">
          {panel === "trash" && (
            <ProjectTrash projectId={project.id} onChanged={() => void load({ silent: true })} />
          )}
        </div>
        <UpgradeDialog
          open={walkthroughUpgradeOpen}
          onOpenChange={setWalkthroughUpgradeOpen}
          feature="Walkthroughs"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-3 pb-32 pt-4 sm:px-4 sm:pt-6 md:py-10">
      <BusyOverlay
        open={uploading}
        title="Uploading photo…"
        description="Compressing and saving to this project"
      />

      {project && (
        <EditProjectDialog
          project={project}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={(next) => setProject({ ...project, ...next } as Project)}
        />
      )}
      {/* Pull-to-refresh indicator (mobile) */}
      <div className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center md:hidden">
        <div
          style={indicatorStyle}
          className={`flex h-9 w-9 -translate-y-12 items-center justify-center rounded-full border border-border bg-background shadow-md transition ${pull > 0 || refreshing ? "opacity-100" : "opacity-0"}`}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <RefreshCw className="h-4 w-4 text-primary" />
          )}
        </div>
      </div>

      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Projects
      </Link>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-[32px] bg-sidebar">
        <div className="pointer-events-none absolute -right-24 -top-28 h-[288px] w-[288px] rounded-full border-[28px] border-sidebar-ring/20" />
        <div className="relative flex flex-col gap-7 p-6 sm:px-10 sm:py-9">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-1 flex-col gap-6 sm:flex-row sm:items-start">
              {/* Cover thumbnail */}
              <div className="relative h-24 w-24 shrink-0 rounded-2xl border border-sidebar-foreground/20 bg-sidebar-foreground/10 p-1 shadow-xl sm:h-28 sm:w-28">
                <div className="h-full w-full overflow-hidden rounded-xl bg-sidebar-foreground/5">
                  {photos[0] && photoSrc(photos[0]) ? (
                    <img
                      src={photoSrc(photos[0])}
                      alt={`${project.name} cover`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sidebar-foreground/40">
                      <ImageOff className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <span
                  className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border-4 border-sidebar"
                  style={{ background: (STATUS_DOT[project.status] ?? STATUS_DOT.active).dot }}
                >
                  <Check className="h-3.5 w-3.5 text-[#101929]" strokeWidth={3} />
                </span>
              </div>

              {/* Title block */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center rounded-full bg-sidebar-ring px-3 py-1 text-[10px] font-extrabold uppercase tracking-[1.4px] text-sidebar-foreground">
                    Project record
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-bold"
                    style={{ color: (STATUS_DOT[project.status] ?? STATUS_DOT.active).text }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: (STATUS_DOT[project.status] ?? STATUS_DOT.active).dot }}
                    />
                    {(STATUS_DOT[project.status] ?? STATUS_DOT.active).label}
                  </span>
                </div>
                <h1 className="font-display mt-3 truncate text-2xl font-bold leading-tight tracking-tight text-sidebar-foreground sm:text-3xl">
                  {project.name}
                </h1>
                {(projectAddress(project) || project.location) && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(projectAddress(project) ?? project.location ?? "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-sidebar-foreground/65 transition hover:text-sidebar-foreground"
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-sidebar-ring" />
                    <span className="truncate">{projectAddress(project) ?? project.location}</span>
                  </a>
                )}
                {contributors.length > 0 && (
                  <div className="mt-4 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-ring text-[8px] font-semibold text-sidebar-foreground">
                      {heroInitials(contributors[0].fullName, contributors[0].email)}
                    </span>
                    <span className="text-xs font-semibold text-sidebar-foreground">
                      {contributors.length}{" "}
                      {contributors.length === 1 ? "contributor" : "contributors"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-2">
              <Button
                onClick={() => void generateReport()}
                disabled={creatingReport}
                className="h-10 rounded-lg bg-sidebar-foreground px-5 font-bold text-sidebar shadow-sm hover:bg-sidebar-foreground/90"
              >
                {creatingReport ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4 text-sidebar-ring" />
                )}
                Create report
              </Button>
              <ProjectActionsMenu
                project={project}
                photos={photos}
                onEdit={() => setEditOpen(true)}
                onTrash={() => setPanel("trash")}
                onDeleted={() => navigate({ to: "/projects" })}
                onStatusChange={(status) => setProject((p) => (p ? { ...p, status } : p))}
                triggerClassName="h-10 w-10 rounded-xl border-sidebar-foreground/15 bg-sidebar-foreground/10 text-sidebar-foreground hover:bg-sidebar-foreground/20 hover:text-sidebar-foreground"
              />
            </div>
          </div>

          {project.description && (
            <p className="-mt-3 max-w-3xl text-sm leading-relaxed text-sidebar-foreground/60">
              {project.description}
            </p>
          )}

          {/* Footer stats row */}
          <div className="flex flex-col gap-4 border-t border-sidebar-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-sidebar-foreground/45">
                Labels
              </span>
              <LabelPicker
                value={projectLabels}
                onChange={(next) => void setProjectLabels(next)}
                suggestions={labelCatalog.rows.map((r) => r.name)}
                triggerLabel="Add label"
                placeholder="Search or create a label"
                userId={user?.id}
                variant="dark"
              />
            </div>
            <div className="flex flex-wrap items-center gap-5 text-xs font-bold text-sidebar-foreground/60">
              {contributors.length > 0 && (
                <span className="inline-flex items-center gap-2">
                  <Users className="h-4 w-4 text-sidebar-ring" />
                  {contributors.length} {contributors.length === 1 ? "contributor" : "contributors"}
                </span>
              )}
              <span className="inline-flex items-center gap-2">
                <Camera className="h-4 w-4 text-sidebar-ring" />
                {(totalPhotos || photos.length).toLocaleString()} field captures
              </span>
              <span className="inline-flex items-center gap-2">
                <Calendar className="h-4 w-4 text-sidebar-ring" />
                Updated {relativeTime(project.updated_at)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3.5 overflow-x-auto rounded-2xl border border-border bg-card/80 p-2 shadow-[0px_16px_32px_-28px_rgba(16,25,41,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-1">
          {(
            [
              { key: "photos", label: "Photos", count: photos.length, icon: Camera },
              { key: "reports", label: "Documents", count: counts.documents, icon: FileText },
              {
                key: "checklists",
                label: "Checklists",
                count: counts.checklists,
                icon: ListChecks,
              },
              {
                key: "walkthroughs",
                label: "Walkthroughs",
                count: walkthroughs.length,
                icon: Footprints,
              },
              { key: "workflows", label: "Workflows", count: counts.workflows, icon: Workflow },
              { key: "tasks", label: "Tasks", count: counts.tasksOpen, icon: CheckSquare },
            ] as const
          ).map((tab) => {
            const active = (tab.key === "photos" && panel === null) || panel === tab.key;
            const Icon = tab.icon;
            const handleClick = () => {
              if (tab.key === "photos") {
                setPanel(null);
                return;
              }
              if (tab.key === "workflows" && !isTeam) {
                setWorkflowsUpgradeOpen(true);
                return;
              }
              setPanel((cur) => (cur === tab.key ? null : (tab.key as any)));
            };
            return (
              <button
                key={tab.key}
                type="button"
                onClick={handleClick}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${
                  active
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                    active ? "bg-primary-foreground/20" : "bg-muted"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {tab.label}
                <span className={active ? "text-primary-foreground/70" : "text-muted-foreground"}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Other panels open as dedicated full pages (see early return above). Walkthroughs renders inline. */}
      {panel === "walkthroughs" && (
        <>
          <div className="mt-9 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
                Narrated site records
              </p>
              <h2 className="font-display mt-3 text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
                Walk the site from anywhere
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                Recorded walkthroughs preserve field context beyond the photo.
              </p>
            </div>
            <Button
              size="sm"
              className="h-8 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
              onClick={() =>
                canUseWalkthroughs ? void startWalkthrough() : setWalkthroughUpgradeOpen(true)
              }
            >
              <Footprints className="mr-1.5 h-3.5 w-3.5" />
              Record walkthrough
            </Button>
          </div>

          {walkthroughs.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center">
              <Mic className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">
                No walkthroughs yet. Start one to capture photos + narration and get an AI report.
              </p>
              <Button
                size="sm"
                className="mt-4 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                onClick={() =>
                  canUseWalkthroughs ? void startWalkthrough() : setWalkthroughUpgradeOpen(true)
                }
              >
                <Footprints className="mr-1.5 h-3.5 w-3.5" />
                Start Walkthrough Note
              </Button>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {walkthroughs.map((w) => {
                const mins = Math.floor((w.duration_seconds || 0) / 60);
                const secs = (w.duration_seconds || 0) % 60;
                return (
                  <div
                    key={w.id}
                    className="group relative overflow-hidden rounded-3xl border border-border bg-card/80 p-6"
                  >
                    <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full border-[18px] border-primary/10" />
                    <div className="relative flex min-h-[172px] flex-col justify-between gap-6">
                      <button
                        type="button"
                        onClick={() => void openWalkthroughVideo(w)}
                        aria-label="Play walkthrough video"
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary transition hover:bg-primary/20"
                      >
                        <PlayCircle className="h-5 w-5" />
                      </button>
                      <div>
                        <p className="font-display truncate text-3xl font-bold leading-tight tracking-tight text-foreground">
                          {w.title}
                        </p>
                        <p className="mt-1 text-xs font-bold text-muted-foreground">
                          {new Date(w.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                          {" · "}
                          {mins}:{secs.toString().padStart(2, "0")}
                        </p>
                        <Link
                          to="/walkthroughs/$walkthroughId"
                          params={{ walkthroughId: w.id }}
                          className="mt-3 inline-flex items-center gap-2 text-xs font-extrabold text-primary hover:underline"
                        >
                          Open walkthrough <span aria-hidden>→</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {panel === "checklists" && <ProjectChecklists projectId={project.id} />}
      {panel === "reports" && (
        <div className="mt-9">
          <ProjectDocuments
            projectId={project.id}
            projectName={project.name}
            projectPhotos={photos.map((p) => ({
              id: p.id,
              url: p.image_url ?? signed[p.storage_path] ?? "",
              caption: p.caption,
              taken_at: p.taken_at,
            }))}
            onChanged={() => void load({ silent: true })}
          />
        </div>
      )}
      {panel === "workflows" && (
        <div className="mt-9">
          <ProjectWorkflows projectId={project.id} />
        </div>
      )}
      {panel === "tasks" && (
        <ProjectTasks
          ref={tasksRef}
          projectId={project.id}
          projectPhotos={photos.map((p) => ({
            id: p.id,
            url: p.image_url ?? signed[p.storage_path] ?? "",
          }))}
        />
      )}

      {panel === null && (
        <>
          {/* Visual documentation */}
          <div className="mt-8 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
                Visual documentation
              </p>
              <h2 className="font-display mt-3 text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
                The field, on record
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                {(totalPhotos || photos.length).toLocaleString()} photos organized by date, label,
                and job activity.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                    Filters
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="show-tags" className="text-sm font-medium">
                        Show project tags
                      </Label>
                      <Switch
                        id="show-tags"
                        checked={showTags}
                        onCheckedChange={(v) => {
                          setShowTags(v);
                          if (!v) setTagFilter([]);
                        }}
                      />
                    </div>

                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Filter tags by
                      </div>
                      <RadioGroup
                        value={tagLogic}
                        onValueChange={(v) => setTagLogic(v as "and" | "or")}
                        className="flex gap-4"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="or" id="tl-or" />
                          <Label htmlFor="tl-or" className="text-sm">
                            Or
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="and" id="tl-and" />
                          <Label htmlFor="tl-and" className="text-sm">
                            And
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Type
                      </div>
                      <Select value={mediaType} onValueChange={(v) => setMediaType(v as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="photos">Photos only</SelectItem>
                          <SelectItem value="videos">Videos only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Photo size
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(
                          [
                            { v: "sm", label: "Small" },
                            { v: "md", label: "Medium" },
                            { v: "lg", label: "Large" },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.v}
                            type="button"
                            onClick={() => setPhotoSize(opt.v)}
                            className={`rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                              photoSize === opt.v
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Order
                      </div>
                      <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as any)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="newest">Newest first</SelectItem>
                          <SelectItem value="oldest">Oldest first</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                className="h-8 rounded-lg bg-primary px-4 text-xs font-bold hover:bg-primary/90"
                onClick={() => setCameraOpen(true)}
              >
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                Capture update
              </Button>
            </div>
          </div>

          {photos.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {(
                [
                  { v: "all", label: "All captures" },
                  { v: "before", label: "Before work" },
                  { v: "after", label: "After work" },
                  { v: "untagged", label: "Needs review" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setPhaseFilter(opt.v)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-extrabold transition ${
                    phaseFilter === opt.v
                      ? "bg-primary text-primary-foreground"
                      : "border-[0.8px] border-border bg-card/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {showTags && photos.length > 0 && allPhotoTags.length > 0 && (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Photo tags · filter photos ({tagLogic.toUpperCase()})
                </div>
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
              <div className="flex flex-wrap items-center gap-2">
                {allPhotoTags.map((t) => {
                  const active = tagFilter.includes(t);
                  const count = photos.filter((p) => (p.tags ?? []).includes(t)).length;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTagFilter(t)}
                      className={`group inline-flex items-center gap-1 rounded-full transition ${active ? "" : "hover:opacity-90"}`}
                      aria-pressed={active}
                      title={active ? `Remove ${t} filter` : `Filter by ${t}`}
                    >
                      <TagPill
                        name={t}
                        size="sm"
                        className={
                          active ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
                        }
                      />
                      <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                        ({count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mediaType === "videos" ? null : photos.length === 0 ? (
            <Card className="mt-3 flex flex-col items-center p-10 text-center border-dashed">
              <ImageOff className="h-9 w-9 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No photos yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Snap a photo on-site or upload from your device.
              </p>
              <div className="mt-4 flex gap-2">
                <Button onClick={() => setCameraOpen(true)} disabled={uploading} className="h-10">
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="mr-2 h-4 w-4" />
                  )}
                  Take photo
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="h-10"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              </div>
            </Card>
          ) : filteredPhotos.length === 0 ? (
            <Card className="mt-3 flex flex-col items-center p-8 text-center border-dashed">
              <ImageOff className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No photos match the current filters.
              </p>
            </Card>
          ) : photoView === "grid" ? (
            <div className="mt-6 space-y-3">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredPhotos.map((p, idx) => {
                  const url = photoSrc(p);
                  const selected = selectedPhotoIds.includes(p.id);
                  const inSelectionMode = selectedPhotoIds.length > 0;
                  const phase = normalizedPhase(p);
                  const when = p.taken_at ?? p.created_at;
                  return (
                    <div
                      key={p.id}
                      className={`group flex flex-col overflow-hidden rounded-2xl border border-border bg-card/[0.82] shadow-[0px_20px_50px_-36px_rgba(16,25,41,0.5)] transition hover:-translate-y-0.5 ${
                        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                      }`}
                    >
                      <div className="relative h-52 w-full shrink-0 bg-muted">
                        <button
                          type="button"
                          onClick={() => {
                            if (inSelectionMode) toggleSelect(p.id);
                            else setLightboxIndex(idx);
                          }}
                          className="absolute inset-0"
                          aria-label={
                            inSelectionMode
                              ? selected
                                ? "Deselect photo"
                                : "Select photo"
                              : "Open photo"
                          }
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={p.caption ?? ""}
                              className="h-full w-full object-cover transition group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-muted-foreground">
                              <ImageOff className="h-6 w-6" />
                            </div>
                          )}
                        </button>
                        {phase !== "untagged" && (
                          <span
                            className={`pointer-events-none absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase text-white ${
                              phase === "after" ? "bg-[#10B981]" : "bg-[#2584F4]"
                            }`}
                          >
                            {phase === "after" ? "After" : "Before"}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(p.id);
                          }}
                          aria-label={selected ? "Deselect" : "Select"}
                          className={`absolute left-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-md border-2 shadow transition ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground opacity-100"
                              : "border-sidebar-foreground/90 bg-sidebar/30 text-transparent opacity-0 backdrop-blur-sm group-hover:opacity-100"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        {p.hidden && (
                          <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-sidebar/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-sidebar-foreground">
                            Hidden
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-1 p-3">
                        <p className="truncate text-xs font-bold text-foreground">
                          {cleanCaption(p.caption) || formatPhotoDateGroup(when)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatPhotoDateGroup(when)} · {relativeTime(when)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {totalPhotos > photos.length && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setPhotoLimit((n) => n + 120)}
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Load more ({totalPhotos - photos.length} remaining)
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <PhotoCarousel
              photos={filteredPhotos}
              photoSrc={photoSrc}
              onOpen={(idx) => setLightboxIndex(idx)}
              onViewAll={() => setPhotoView("grid")}
              size={photoSize}
              showTags={false}
              selectedIds={selectedPhotoIds}
              onToggleSelect={toggleSelect}
            />
          )}

          <PhotoBulkActionBar
            projectId={projectId}
            userId={user?.id ?? null}
            selectedIds={selectedPhotoIds}
            photosById={
              new Map<string, BulkPhoto>(
                filteredPhotos.map((p) => [
                  p.id,
                  {
                    id: p.id,
                    url: photoSrc(p),
                    caption: p.caption,
                    taken_at: p.taken_at,
                    created_at: p.created_at,
                    hidden: !!p.hidden,
                    tags: p.tags,
                  },
                ]),
              )
            }
            totalVisible={filteredPhotos.length}
            allExistingTags={allPhotoTags}
            onClear={clearSelection}
            onSelectAll={() => setSelectedPhotoIds(filteredPhotos.map((p) => p.id))}
            onRefresh={() => void load({ silent: true })}
          />

          {/* Walkthrough Notes — rendered inside the three-dot menu modal below */}

          {/* Site videos */}
          {videos.length > 0 && mediaType !== "photos" && (
            <div className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Site videos</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => setVideoOpen(true)}
                >
                  <Video className="mr-1.5 h-4 w-4" />
                  Record video
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {videos.map((v) => {
                  const mins = Math.floor((v.duration_seconds || 0) / 60);
                  const secs = (v.duration_seconds || 0) % 60;
                  return (
                    <div
                      key={v.id}
                      className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <div className="relative">
                        <VideoThumbnail
                          cacheKey={`video:${v.id}`}
                          videoUrl={v.signed_url}
                          onClick={() => {
                            if (v.signed_url) {
                              setPlayerVideo({
                                url: v.signed_url,
                                title: v.caption ?? "Site video",
                                mime: v.mime_type,
                              });
                            }
                          }}
                        />
                        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-sidebar/75 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sidebar-foreground shadow">
                          {mins}:{secs.toString().padStart(2, "0")}
                        </span>
                      </div>
                      <div className="p-3">
                        <div className="truncate text-sm font-semibold">
                          {v.caption ?? "Site video"}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {new Date(v.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                          {" · "}
                          {Math.max(1, Math.round((v.size_bytes ?? 0) / 1024 / 1024))} MB
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Floating camera button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={uploading}
            aria-label="Add photo or video"
            className="fixed bottom-24 right-5 z-30 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 ring-4 ring-background transition active:scale-95 disabled:opacity-50 md:bottom-8"
          >
            {uploading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <Camera className="h-7 w-7" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="mb-2 w-64">
          <DropdownMenuItem onClick={() => setCameraOpen(true)}>
            <Camera className="mr-2 h-4 w-4" />
            Take photo with camera
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInput.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Upload from gallery
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setVideoOpen(true)}>
            <Video className="mr-2 h-4 w-4" />
            Record video
            <span className="ml-auto text-[10px] text-muted-foreground">
              {tier === "team" ? "10 min" : "5 min"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TagPhotoDialog
        open={!!pendingFiles}
        count={pendingFiles?.length ?? 0}
        onClose={() => {
          setPendingFiles(null);
          if (fileInput.current) fileInput.current.value = "";
        }}
        onSelect={(tag, tags) => void processPendingWithTag(tag, tags)}
        existingTags={allPhotoTags}
        onCreateTag={createPhotoTag}
      />

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={onCameraCapture}
        canAnalyze={isActive}
        watermark={watermarkCtx(project)}
        existingTags={allPhotoTags}
        onCreateTag={createPhotoTag}
        onOpenWalkthrough={() => setWalkthroughOpen(true)}
        onOpenVideo={() => setVideoOpen(true)}
        canMeasure={isPro}
      />

      <VideoRecorder
        open={videoOpen}
        onClose={() => setVideoOpen(false)}
        canRecord={isActive}
        tierLabel={TIER_LABEL[tier] ?? TIER_LABEL.starter}
        maxSeconds={VIDEO_MAX_SECONDS[tier] ?? VIDEO_MAX_SECONDS.starter}
        onSave={onVideoSave}
      />

      <WalkthroughRecorder
        open={walkthroughOpen}
        onClose={() => void onWalkthroughClose()}
        canRecord={canUseWalkthroughs}
        tierLabel={TIER_LABEL[tier] ?? TIER_LABEL.starter}
        maxSeconds={WALKTHROUGH_MAX_SECONDS[tier] ?? WALKTHROUGH_MAX_SECONDS.pro}
        watermark={watermarkCtx(project)}
        onCapturePhoto={onWalkthroughCapture}
        onFinish={onWalkthroughFinish}
        onContinueInBackground={() => {
          // The user can safely leave the processing overlay — the upload and
          // report generation continue in the background. We just close the
          // recorder; they stay on the project page where the walkthrough
          // card will flip from "Generating" to "Ready" via realtime updates.
          setWalkthroughOpen(false);
          toast.message(
            "Working in the background — your report will appear here when it's ready.",
          );
        }}
      />

      <UpgradeDialog
        open={walkthroughUpgradeOpen}
        onOpenChange={setWalkthroughUpgradeOpen}
        feature="Walkthrough Notes"
        description="Capture photos with narration and get an AI-generated report. Available on the Pro and Team plans."
      />

      <UpgradeDialog
        open={workflowsUpgradeOpen}
        onOpenChange={setWorkflowsUpgradeOpen}
        feature="Workflows"
        description="Multi-phase workflows with checklists, photos, and sign-offs per phase are available on the Team plan."
        recommendedPlan="team"
      />

      <VideoPlayerDialog
        open={!!playerVideo}
        onClose={() => setPlayerVideo(null)}
        videoUrl={playerVideo?.url ?? null}
        title={playerVideo?.title}
        mimeType={playerVideo?.mime ?? null}
        emptyMessage={playerVideo?.emptyMessage}
      />

      {lightboxIndex !== null && filteredPhotos.length > 0 && (
        <PhotoLightbox
          photos={filteredPhotos.map((p) => ({
            id: p.id,
            url: photoSrc(p),
            caption: p.caption,
            takenAt: p.taken_at ?? p.created_at,
          }))}
          index={Math.min(lightboxIndex, filteredPhotos.length - 1)}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={(i) => setLightboxIndex(i)}
          renderActions={(lp) => {
            const ph = filteredPhotos.find((x) => x.id === lp.id);
            if (!ph) return null;
            return (
              <button
                type="button"
                aria-label="Annotate"
                title="Annotate"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-sidebar-foreground/10 text-sidebar-foreground hover:bg-sidebar-foreground/20 transition"
                onClick={() => setAnnotatePhotoId(ph.id)}
              >
                <Pencil className="h-5 w-5" />
              </button>
            );
          }}
          onSharePhoto={(lp) => {
            const ph = filteredPhotos.find((x) => x.id === lp.id);
            if (!ph) return;
            void sharePhotoNative({ url: photoSrc(ph), title: ph.caption ?? "Photo" });
          }}
          renderSidePanel={(lp) => {
            const ph = filteredPhotos.find((x) => x.id === lp.id);
            if (!ph || !user) return null;
            const photoTags = ph.tags ?? [];
            return (
              <PhotoDetailsPanel
                project={{
                  name: project.name,
                  address: projectAddress(project) ?? project.location ?? null,
                  createdAt: (project as any).created_at ?? null,
                }}
                photo={{
                  id: ph.id,
                  takenAt: ph.taken_at ?? ph.created_at,
                  latitude: ph.latitude,
                  longitude: ph.longitude,
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
                          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-sidebar-foreground/20 bg-sidebar-foreground/[0.03] px-2.5 text-[11px] font-medium text-sidebar-foreground/70 transition hover:border-sidebar-foreground/40 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
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
                    projectId={projectId}
                    currentUserId={user.id}
                    contributors={contributors}
                  />
                }
                commentsSlot={
                  <PhotoCommentsPanel
                    photoId={lp.id}
                    projectId={projectId}
                    currentUserId={user.id}
                    contributors={contributors}
                  />
                }
              />
            );
          }}
        />
      )}

      {/* OCR / Scan text dialog */}
      <Dialog
        open={ocrOpen}
        onOpenChange={(o) => {
          if (!o) {
            setOcrOpen(false);
            setOcrText("");
            setOcrCopied(false);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TypeIcon className="h-4 w-4" /> Scanned text
            </DialogTitle>
          </DialogHeader>
          {ocrLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Reading text from photo…</span>
            </div>
          ) : (
            <>
              <Textarea
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                rows={10}
                className="resize-none font-mono text-sm"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(ocrText);
                      setOcrCopied(true);
                      toast.success("Copied to clipboard");
                      setTimeout(() => setOcrCopied(false), 1500);
                    } catch {
                      toast.error("Copy failed");
                    }
                  }}
                  disabled={!ocrText || ocrText === "(no text found)"}
                >
                  {ocrCopied ? (
                    <Check className="mr-1.5 h-4 w-4" />
                  ) : (
                    <CopyIcon className="mr-1.5 h-4 w-4" />
                  )}
                  {ocrCopied ? "Copied" : "Copy"}
                </Button>
                <Button type="button" onClick={() => setOcrOpen(false)}>
                  Done
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {annotatePhotoId &&
        (() => {
          const ph = photos.find((x) => x.id === annotatePhotoId);
          const url = ph ? photoSrc(ph) : "";
          if (!ph || !url) return null;
          return (
            <PhotoAnnotator
              open={true}
              imageUrl={url}
              onClose={() => setAnnotatePhotoId(null)}
              canMeasure={isPro}
              onSave={async (blob) => {
                if (!user || !project) return;
                try {
                  const path = `${user.id}/${project.id}/${crypto.randomUUID()}.jpg`;
                  const { error: upErr } = await supabase.storage
                    .from("site-photos")
                    .upload(path, blob, { contentType: "image/jpeg" });
                  if (upErr) throw upErr;
                  const baseCaption = ph.caption ?? "Photo";
                  const { error: insErr } = await supabase.from("photos").insert({
                    project_id: project.id,
                    uploaded_by: user.id,
                    storage_path: path,
                    size_bytes: blob.size,
                    caption: baseCaption.startsWith("Annotated:")
                      ? baseCaption
                      : `Annotated: ${baseCaption}`,
                    phase: ph.phase ?? "untagged",
                  } as any);
                  if (insErr) throw insErr;
                  toast.success("Annotated photo saved");
                  setAnnotatePhotoId(null);
                  await load();
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed to save annotated photo");
                }
              }}
            />
          );
        })()}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onUpload(e.target.files)}
      />
    </div>
  );
}
