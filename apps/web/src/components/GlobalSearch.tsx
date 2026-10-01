import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderKanban, Images, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import { listReportPages } from "@/lib/project-pages.functions";
import { qk } from "@/lib/query-keys";
import {
  isSearchShortcut,
  matchProjects,
  matchReports,
  projectAddress,
  type SearchProject,
  type SearchReport,
} from "@/lib/global-search";
import { cn } from "@/lib/utils";

/**
 * One search for the whole app: projects, photos and reports.
 *
 * It used to be a box in the top header, which put a second search on every
 * page that had its own (Overview, Projects, Photo Library) and left the
 * Overview's own box as a picture of one. Now the header carries none. The
 * palette lives here, opens from Cmd/Ctrl+K on any signed-in page, and the
 * Overview's search box opens it; Projects and the Photo Library keep their
 * own filters, which narrow the list in front of you.
 *
 * Projects and reports are loaded once when the palette first opens and
 * matched on the client (lib/global-search.ts). Photos are handed to the
 * Photo Library with `?q=`, which already searches captions and job addresses
 * on the server; a submit with no pick lands on the Projects list filtered by
 * the query, which is what the header box used to do.
 */

type GlobalSearchContextValue = { openSearch: () => void };

const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

/** `openSearch()` opens the palette. A no-op outside the signed-in app shell. */
export function useGlobalSearch(): GlobalSearchContextValue {
  return useContext(GlobalSearchContext) ?? { openSearch: () => {} };
}

export function GlobalSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSearch = useCallback(() => setOpen(true), []);

  /* Cmd+K / Ctrl+K from anywhere in the app. A keystroke something else has
     already claimed (the rich text editor's link shortcut) is left alone. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSearchShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(() => ({ openSearch }), [openSearch]);

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </GlobalSearchContext.Provider>
  );
}

type ProjectHit = SearchProject & { id: string; name: string };

function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const projectsQuery = useQuery({
    queryKey: [...qk.globalSearch(user?.id ?? ""), "projects"],
    enabled: open && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<ProjectHit[]> => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, name, street, city, state, location")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data as ProjectHit[]) ?? [];
    },
  });

  const reportsQuery = useQuery({
    queryKey: [...qk.globalSearch(user?.id ?? ""), "reports"],
    enabled: open && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<SearchReport[]> => {
      /* The same two homes the project's Reports tab lists: the older report
         builder and report pages. Either can fail on its own without taking
         the other, or the project results, down with it. */
      const [legacy, pages] = await Promise.all([
        (supabase as any)
          .from("project_reports")
          .select("id, project_id, title, created_at")
          .order("created_at", { ascending: false })
          .limit(500)
          .then((r: any) => (r.error ? [] : ((r.data as any[]) ?? [])))
          .catch(() => []),
        listReportPages({ data: {} })
          .then((r) => r.reports ?? [])
          .catch(() => []),
      ]);
      return [
        ...legacy.map(
          (r: any): SearchReport => ({
            kind: "legacy",
            id: r.id,
            projectId: r.project_id,
            projectName: null,
            title: r.title ?? "Untitled report",
            date: r.created_at,
          }),
        ),
        ...pages.map(
          (p): SearchReport => ({
            kind: "page",
            id: p.id,
            projectId: p.projectId,
            projectName: p.projectName,
            title: p.title || "Untitled report",
            date: p.updatedAt || p.createdAt,
          }),
        ),
      ];
    },
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name] as const)),
    [projects],
  );
  const reports = useMemo(
    () =>
      (reportsQuery.data ?? []).map((r) => ({
        ...r,
        projectName: r.projectName ?? projectNameById.get(r.projectId) ?? null,
      })),
    [reportsQuery.data, projectNameById],
  );

  const term = query.trim();
  const projectHits = matchProjects(term, projects);
  const reportHits = matchReports(term, reports);

  const go = (to: () => void) => {
    onOpenChange(false);
    to();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search projects, photos and reports across your workspace.
        </DialogDescription>
        <Command shouldFilter={false} className="rounded-none">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search projects, photos, reports…"
            aria-label="Search projects, photos and reports"
            className="h-12 pr-10"
          />
          <CommandList className="max-h-[min(420px,60dvh)]">
            {projectHits.length > 0 && (
              <CommandGroup heading={term ? "Projects" : "Recent projects"}>
                {projectHits.map((p) => {
                  const address = projectAddress(p);
                  return (
                    <CommandItem
                      key={p.id}
                      value={`project:${p.id}`}
                      onSelect={() =>
                        go(() =>
                          navigate({ to: "/projects/$projectId", params: { projectId: p.id } }),
                        )
                      }
                    >
                      <FolderKanban className="text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        {address && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {address}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {reportHits.length > 0 && (
              <CommandGroup heading="Reports">
                {reportHits.map((r) => (
                  <CommandItem
                    key={`${r.kind}:${r.id}`}
                    value={`report:${r.kind}:${r.id}`}
                    onSelect={() =>
                      go(() =>
                        r.kind === "page"
                          ? navigate({
                              to: "/projects/$projectId/pages/$pageId",
                              params: { projectId: r.projectId, pageId: r.id },
                            })
                          : navigate({
                              to: "/projects/$projectId/reports/$reportId",
                              params: { projectId: r.projectId, reportId: r.id },
                            }),
                      )
                    }
                  >
                    <FileText className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.title}</span>
                      {r.projectName && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.projectName}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Always offered once something is typed, so Enter with no match
                still goes somewhere useful. */}
            {term && (
              <CommandGroup heading="Search everywhere">
                <CommandItem
                  value="all:photos"
                  onSelect={() => go(() => navigate({ to: "/gallery", search: { q: term } }))}
                >
                  <Images className="text-muted-foreground" />
                  <span className="truncate">Photos matching "{term}"</span>
                </CommandItem>
                <CommandItem
                  value="all:projects"
                  onSelect={() =>
                    go(() => navigate({ to: "/projects", search: { q: term } as any }))
                  }
                >
                  <Search className="text-muted-foreground" />
                  <span className="truncate">All projects matching "{term}"</span>
                </CommandItem>
              </CommandGroup>
            )}

            {!term && projectHits.length === 0 && (
              <p
                className={cn(
                  "px-4 py-6 text-center text-sm text-muted-foreground",
                  projectsQuery.isLoading && "animate-pulse",
                )}
              >
                {projectsQuery.isLoading
                  ? "Loading your projects…"
                  : "Type to search projects, photos and reports."}
              </p>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
