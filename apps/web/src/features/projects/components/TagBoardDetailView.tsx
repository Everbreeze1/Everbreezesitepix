import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, Settings2, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { AddProjectToTagDialog } from "@/features/projects/components/AddProjectToTagDialog";
import type { ProjectBoard } from "@/lib/project-boards.functions";

interface ProjectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  street: string | null;
  location: string | null;
  updated_at: string;
  created_at: string;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
}

function projectAddress(p: ProjectRow): string | null {
  if (p.location?.trim()) return p.location;
  const parts = [p.street, p.city, p.state].filter((x): x is string => !!x && x.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

export function TagBoardDetailView({
  board,
  allTags,
  allProjects,
  projectTagMap,
  onBack,
  onManage,
  onTagAssigned,
}: {
  board: ProjectBoard;
  allTags: TagRow[];
  allProjects: ProjectRow[];
  projectTagMap: Record<string, TagRow[]>;
  onBack: () => void;
  onManage: () => void;
  onTagAssigned: (projectId: string, tag: TagRow) => void;
}) {
  const [addingToTag, setAddingToTag] = useState<TagRow | null>(null);

  const columns = useMemo(
    () =>
      board.tag_ids
        .map((tid) => allTags.find((t) => t.id === tid))
        .filter((t): t is TagRow => !!t)
        .map((tag) => ({
          tag,
          projects: allProjects.filter((p) => (projectTagMap[p.id] ?? []).some((t) => t.id === tag.id)),
        })),
    [board.tag_ids, allTags, allProjects, projectTagMap],
  );

  const alreadyTaggedIds = addingToTag
    ? new Set(allProjects.filter((p) => (projectTagMap[p.id] ?? []).some((t) => t.id === addingToTag.id)).map((p) => p.id))
    : new Set<string>();

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Boards
      </button>

      <div className="mt-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight text-foreground">{board.name}</h2>
        <Button variant="outline" size="sm" onClick={onManage}>
          <Settings2 className="mr-1.5 h-4 w-4" /> Manage Board
        </Button>
      </div>

      {columns.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          This board has no tags configured yet — use "Manage Board" to add some.
        </p>
      ) : (
        <div className="mt-5 flex gap-4 overflow-x-auto pb-4">
          {columns.map(({ tag, projects }) => (
            <div key={tag.id} className="w-[280px] shrink-0">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold shadow-sm"
                  style={{ background: tag.color, color: "#fff" }}
                >
                  {tag.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAddingToTag(tag)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Add project to ${tag.name}`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 space-y-2 rounded-xl bg-muted/40 p-2">
                {projects.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    Projects with this tag will appear here.
                  </p>
                ) : (
                  projects.map((p) => {
                    const addr = projectAddress(p);
                    return (
                      <Link
                        key={p.id}
                        to="/projects/$projectId"
                        params={{ projectId: p.id }}
                        search={{} as any}
                        className="group block rounded-lg border border-border bg-card p-3 hover:border-primary/40"
                      >
                        <p className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true })}
                        </p>
                        <p className="mt-1 flex items-center justify-between gap-1 truncate text-sm font-bold text-foreground">
                          {p.name}
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </p>
                        {addr && <p className="mt-0.5 truncate text-xs text-muted-foreground">{addr}</p>}
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {addingToTag && (
        <AddProjectToTagDialog
          open={!!addingToTag}
          tag={addingToTag}
          projects={allProjects.filter((p) => !alreadyTaggedIds.has(p.id))}
          onClose={() => setAddingToTag(null)}
          onAdded={(projectId) => {
            onTagAssigned(projectId, addingToTag);
            setAddingToTag(null);
          }}
        />
      )}
    </div>
  );
}
