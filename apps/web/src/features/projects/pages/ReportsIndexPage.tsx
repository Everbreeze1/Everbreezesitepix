import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  FileText,
  Loader2,
  Copy,
  ExternalLink,
  Download,
  Eye,
  EyeOff,
  Pencil,
  ArrowRight,
  Image as ImageIcon,
  MoreVertical,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/everlumen/client";
import { everlumenApi } from "@/lib/everlumen-api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { BlueprintItemBadge } from "@/features/projects/components/BlueprintItemBadge";
import { listBlueprintItemSources, type BlueprintSourceMap } from "@/lib/blueprint.functions";
import {
  generatePagePdf,
  listReportPages,
  setProjectPageShare,
  type ReportPageSummary,
} from "@/lib/project-pages.functions";
import { downloadBase64File } from "@/lib/download-file";

interface ReportRow {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  share_token: string;
  revoked_at: string | null;
  created_at: string;
  cover_photo_ids: string[] | null;
  /**
   * Report template this was generated from, for the blueprint badge. Optional:
   * absent on a database that has not yet run 20260812000000.
   */
  source_template?: string | null;
}
/**
 * One row on screen. Reports live in two places: the older report builder
 * (`project_reports`) and report pages (`project_pages` filed under Reports,
 * which is what a project's Create menu makes today). Both are listed, newest
 * first, and each row knows which kind it is so its links and actions go to
 * the right editor, share page and PDF.
 */
type ListRow =
  | { kind: "legacy"; key: string; report: ReportRow; date: string }
  | { kind: "page"; key: string; page: ReportPageSummary; date: string };

interface ProjRow {
  id: string;
  name: string;
}

export function ReportsIndexPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [pageReports, setPageReports] = useState<ReportPageSummary[]>([]);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Map<string, ProjRow>>(new Map());
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  /** projectId → (source template id → blueprint), for the per-report badge. */
  const [blueprintSources, setBlueprintSources] = useState<Record<string, BlueprintSourceMap>>({});

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      /*
       * `source_template` is added by migration 20260812000000. Code and
       * migrations do not deploy atomically here, and PostgREST rejects the
       * ENTIRE select over one unknown column - so naming it unconditionally
       * would have taken the whole Reports screen down on any database still
       * waiting for that migration. Ask for it, and fall back to the column list
       * that has always existed if it is not there yet; the only thing lost is
       * the blueprint badge.
       */
      const BASE_COLUMNS =
        "id, project_id, title, summary, share_token, revoked_at, created_at, cover_photo_ids";
      const loadReports = async () => {
        const withSource = await (supabase as any)
          .from("project_reports")
          .select(`${BASE_COLUMNS}, source_template`)
          .order("created_at", { ascending: false });
        if (!withSource.error) return withSource;
        console.warn("[reports] source_template unavailable, loading without it", {
          code: withSource.error?.code,
        });
        return await (supabase as any)
          .from("project_reports")
          .select(BASE_COLUMNS)
          .order("created_at", { ascending: false });
      };

      const loadPageReports = async () => {
        try {
          const res = await listReportPages({ data: {} });
          return res.reports ?? [];
        } catch (e: any) {
          console.warn("[reports] report pages unavailable", { message: e?.message });
          return [] as ReportPageSummary[];
        }
      };

      const [{ data: rs }, { data: ps }, pageRows] = await Promise.all([
        loadReports(),
        (supabase as any).from("projects").select("id, name"),
        loadPageReports(),
      ]);
      if (cancelled) return;
      setPageReports(pageRows);
      const rows = (rs as ReportRow[]) ?? [];
      setReports(rows);
      const map = new Map<string, ProjRow>();
      ((ps as ProjRow[]) ?? []).forEach((p) => map.set(p.id, p));
      setProjects(map);

      /*
       * Which blueprint produced each report. Batched across every project on
       * screen - one call, not one per project - and best-effort: a report that
       * cannot be attributed simply carries no badge, which is also the correct
       * rendering for a report someone built by hand.
       */
      const projectIds = Array.from(new Set(rows.map((r) => r.project_id))).slice(0, 200);
      if (projectIds.length) {
        try {
          const res = await listBlueprintItemSources({ data: { projectIds } });
          if (!cancelled && res.status === "ok") setBlueprintSources(res.byProject ?? {});
        } catch (e: any) {
          console.warn("[reports] blueprint sources unavailable", { message: e?.message });
        }
      }

      // Resolve a thumbnail per report: cover photo first, else first section photo
      const reportToPhotoId = new Map<string, string>();
      const needSectionsFor: string[] = [];
      rows.forEach((r) => {
        const cov = Array.isArray(r.cover_photo_ids) ? r.cover_photo_ids : [];
        if (cov.length > 0) reportToPhotoId.set(r.id, cov[0]);
        else needSectionsFor.push(r.id);
      });
      if (needSectionsFor.length) {
        const { data: secRows } = await (supabase as any)
          .from("project_report_sections")
          .select("report_id, position, photos")
          .in("report_id", needSectionsFor)
          .order("position", { ascending: true });
        ((secRows as any[]) ?? []).forEach((s) => {
          if (reportToPhotoId.has(s.report_id)) return;
          const pid = Array.isArray(s.photos) && s.photos[0]?.photo_id;
          if (pid) reportToPhotoId.set(s.report_id, pid);
        });
      }

      const photoIds = Array.from(new Set(reportToPhotoId.values()));
      const urlByPhoto = new Map<string, string>();
      if (photoIds.length) {
        const { data: photoRows } = await (supabase as any)
          .from("photos")
          .select("id, image_url, storage_path")
          .in("id", photoIds);
        const rows2 = (photoRows as any[]) ?? [];
        await Promise.all(
          rows2.map(async (p) => {
            if (p.image_url) {
              urlByPhoto.set(p.id, p.image_url);
              return;
            }
            if (p.storage_path) {
              const { data: s } = await (supabase as any).storage
                .from("site-photos")
                .createSignedUrl(p.storage_path, 60 * 60);
              if (s?.signedUrl) urlByPhoto.set(p.id, s.signedUrl);
            }
          }),
        );
      }
      const thumbMap = new Map<string, string>();
      reportToPhotoId.forEach((pid, rid) => {
        const u = urlByPhoto.get(pid);
        if (u) thumbMap.set(rid, u);
      });
      if (!cancelled) setThumbs(thumbMap);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function toggleRevoke(r: ReportRow) {
    const revoked_at = r.revoked_at ? null : new Date().toISOString();
    const { error } = await (supabase as any)
      .from("project_reports")
      .update({ revoked_at })
      .eq("id", r.id);
    if (error) {
      toast.error("Couldn't update", { description: error.message });
      return;
    }
    setReports((rs) => rs.map((x) => (x.id === r.id ? { ...x, revoked_at } : x)));
    toast.success(revoked_at ? "Share link disabled" : "Share link re-enabled");
  }
  async function togglePageShare(p: ReportPageSummary) {
    const enable = !!p.revokedAt;
    try {
      const res = await setProjectPageShare({ data: { pageId: p.id, enable } });
      setPageReports((rs) =>
        rs.map((x) =>
          x.id === p.id
            ? {
                ...x,
                shareToken: res.shareToken,
                revokedAt: enable ? null : new Date().toISOString(),
              }
            : x,
        ),
      );
      toast.success(enable ? "Share link re-enabled" : "Share link disabled");
    } catch (e: any) {
      toast.error("Couldn't update", { description: e?.message });
    }
  }
  async function downloadPagePdf(p: ReportPageSummary) {
    setExportingId(p.id);
    try {
      const res = await generatePagePdf({ data: { pageId: p.id } });
      downloadBase64File(res.pdfBase64, res.filename);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not export PDF");
    } finally {
      setExportingId(null);
    }
  }
  function shareUrl(row: ListRow) {
    if (typeof window === "undefined") return "";
    return row.kind === "page"
      ? `${window.location.origin}/share/pages/${row.page.shareToken}`
      : `${window.location.origin}/share/reports/${row.report.share_token}`;
  }
  async function copyLink(row: ListRow) {
    try {
      await navigator.clipboard.writeText(shareUrl(row));
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  const rows: ListRow[] = [
    ...reports.map(
      (r): ListRow => ({ kind: "legacy", key: `r:${r.id}`, report: r, date: r.created_at }),
    ),
    ...pageReports.map(
      (p): ListRow => ({ kind: "page", key: `p:${p.id}`, page: p, date: p.createdAt }),
    ),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const filtered = rows.filter((row) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const title = row.kind === "page" ? row.page.title : row.report.title;
    const projectId = row.kind === "page" ? row.page.projectId : row.report.project_id;
    const projectName =
      (row.kind === "page" ? row.page.projectName : null) ?? projects.get(projectId)?.name ?? "";
    return title.toLowerCase().includes(q) || projectName.toLowerCase().includes(q);
  });

  return (
    <div className="container mx-auto max-w-5xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader
        eyebrow="Documentation"
        title="Reports"
        description="All reports across your projects."
        actions={
          <Button asChild variant="outline">
            <Link to="/projects">
              <ArrowRight className="mr-1 h-4 w-4" /> Open a project to create a report
            </Link>
          </Button>
        }
      />

      <div className="mb-4">
        <Input
          placeholder="Search by report or project name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={FileText}
            title={rows.length === 0 ? "No reports yet" : "No matches"}
            description={
              rows.length === 0
                ? "Open any project and create your first client-ready report."
                : "Try a different search term."
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {filtered.map((row) => {
            const isPage = row.kind === "page";
            const r = row.kind === "legacy" ? row.report : null;
            const pg = row.kind === "page" ? row.page : null;
            const id = isPage ? pg!.id : r!.id;
            const projectId = isPage ? pg!.projectId : r!.project_id;
            const title = isPage ? pg!.title : r!.title;
            const projectName = (isPage ? pg!.projectName : null) ?? projects.get(projectId)?.name;
            const thumb = r ? thumbs.get(r.id) : undefined;
            const disabled = isPage ? !!pg!.revokedAt : !!r!.revoked_at;
            const openLink = isPage
              ? ({
                  to: "/projects/$projectId/pages/$pageId",
                  params: { projectId, pageId: id },
                } as const)
              : ({
                  to: "/projects/$projectId/reports/$reportId",
                  params: { projectId, reportId: id },
                } as const);
            return (
              <li key={row.key}>
                <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
                  <div className="flex items-stretch gap-0">
                    <Link
                      {...(openLink as any)}
                      className="relative block h-28 w-28 shrink-0 overflow-hidden bg-muted sm:h-32 sm:w-44"
                      aria-label={`Open ${title}`}
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          {isPage ? (
                            <FileText className="h-7 w-7" />
                          ) : (
                            <ImageIcon className="h-7 w-7" />
                          )}
                        </div>
                      )}
                    </Link>

                    <div className="flex min-w-0 flex-1 items-start gap-2 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            {...(openLink as any)}
                            className="truncate font-semibold leading-tight hover:underline"
                          >
                            {title}
                          </Link>
                          {disabled && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Link off
                            </Badge>
                          )}
                          {r && (
                            <BlueprintItemBadge
                              source={
                                r.source_template
                                  ? blueprintSources[r.project_id]?.[r.source_template]
                                  : null
                              }
                            />
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          {projectName ? (
                            <Link
                              to="/projects/$projectId"
                              params={{ projectId }}
                              className="hover:underline"
                            >
                              {projectName}
                            </Link>
                          ) : (
                            <span>Unknown project</span>
                          )}
                          <span aria-hidden>·</span>
                          <span>{new Date(row.date).toLocaleDateString()}</span>
                        </div>
                        {r?.summary && (
                          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                            {r.summary}
                          </p>
                        )}
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="-mr-1 h-8 w-8 shrink-0"
                            aria-label="More actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild>
                            <Link {...(openLink as any)}>
                              <Pencil className="mr-2 h-4 w-4" /> Open report
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={disabled} onSelect={() => copyLink(row)}>
                            <Copy className="mr-2 h-4 w-4" /> Copy link
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild disabled={disabled}>
                            <a href={shareUrl(row)} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" /> Open share
                            </a>
                          </DropdownMenuItem>
                          {pg ? (
                            <DropdownMenuItem
                              disabled={exportingId === pg.id}
                              onSelect={() => void downloadPagePdf(pg)}
                            >
                              <Download className="mr-2 h-4 w-4" /> Download PDF
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem asChild disabled={disabled}>
                              <a
                                href={everlumenApi.urls.reportPdf(r!.share_token)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Download className="mr-2 h-4 w-4" /> Download PDF
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => (pg ? void togglePageShare(pg) : void toggleRevoke(r!))}
                          >
                            {disabled ? (
                              <>
                                <Eye className="mr-2 h-4 w-4" /> Re-enable link
                              </>
                            ) : (
                              <>
                                <EyeOff className="mr-2 h-4 w-4" /> Disable link
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
