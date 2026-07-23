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
import { supabase } from "@/integrations/sitepix/client";
import { sitepixApi } from "@/lib/sitepix-api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";

interface ReportRow {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  share_token: string;
  revoked_at: string | null;
  created_at: string;
  cover_photo_ids: string[] | null;
}
interface ProjRow {
  id: string;
  name: string;
}

export function ReportsIndexPage() {
  const { user } = useAuth();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [projects, setProjects] = useState<Map<string, ProjRow>>(new Map());
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: rs }, { data: ps }] = await Promise.all([
        (supabase as any)
          .from("project_reports")
          .select(
            "id, project_id, title, summary, share_token, revoked_at, created_at, cover_photo_ids",
          )
          .order("created_at", { ascending: false }),
        (supabase as any).from("projects").select("id, name"),
      ]);
      if (cancelled) return;
      const rows = (rs as ReportRow[]) ?? [];
      setReports(rows);
      const map = new Map<string, ProjRow>();
      ((ps as ProjRow[]) ?? []).forEach((p) => map.set(p.id, p));
      setProjects(map);

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
  function shareUrl(t: string) {
    return typeof window === "undefined" ? "" : `${window.location.origin}/share/reports/${t}`;
  }
  async function copyLink(t: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(t));
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  const filtered = reports.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.title.toLowerCase().includes(q) ||
      (projects.get(r.project_id)?.name.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 md:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <FileText className="h-6 w-6 text-primary" /> Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">All reports across your projects.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/projects">
            <ArrowRight className="mr-1 h-4 w-4" /> Open a project to create a report
          </Link>
        </Button>
      </div>

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
            title={reports.length === 0 ? "No reports yet" : "No matches"}
            description={
              reports.length === 0
                ? "Open any project and create your first client-ready report."
                : "Try a different search term."
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {filtered.map((r) => {
            const proj = projects.get(r.project_id);
            const thumb = thumbs.get(r.id);
            const disabled = !!r.revoked_at;
            return (
              <li key={r.id}>
                <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
                  <div className="flex items-stretch gap-0">
                    <Link
                      to="/projects/$projectId/reports/$reportId"
                      params={{ projectId: r.project_id, reportId: r.id }}
                      className="relative block h-28 w-28 shrink-0 overflow-hidden bg-muted sm:h-32 sm:w-44"
                      aria-label={`Open ${r.title}`}
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
                          <ImageIcon className="h-7 w-7" />
                        </div>
                      )}
                    </Link>

                    <div className="flex min-w-0 flex-1 items-start gap-2 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/projects/$projectId/reports/$reportId"
                            params={{ projectId: r.project_id, reportId: r.id }}
                            className="truncate font-semibold leading-tight hover:underline"
                          >
                            {r.title}
                          </Link>
                          {disabled && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              Disabled
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          {proj ? (
                            <Link
                              to="/projects/$projectId"
                              params={{ projectId: r.project_id }}
                              className="hover:underline"
                            >
                              {proj.name}
                            </Link>
                          ) : (
                            <span>Unknown project</span>
                          )}
                          <span aria-hidden>·</span>
                          <span>{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                        {r.summary && (
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
                            <Link
                              to="/projects/$projectId/reports/$reportId"
                              params={{ projectId: r.project_id, reportId: r.id }}
                            >
                              <Pencil className="mr-2 h-4 w-4" /> Open builder
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={disabled}
                            onSelect={() => copyLink(r.share_token)}
                          >
                            <Copy className="mr-2 h-4 w-4" /> Copy link
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild disabled={disabled}>
                            <a href={shareUrl(r.share_token)} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" /> Open share
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild disabled={disabled}>
                            <a
                              href={sitepixApi.urls.reportPdf(r.share_token)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Download className="mr-2 h-4 w-4" /> Download PDF
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => toggleRevoke(r)}>
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
