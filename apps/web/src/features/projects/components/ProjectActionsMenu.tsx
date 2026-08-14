"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  MoreVertical,
  SquarePen,
  GitMerge,
  FolderPlus,
  Trash2,
  Navigation,
  Archive,
  ArchiveRestore,
  QrCode,
  FileArchive,
  History,
  AlertTriangle,
  Loader2,
  Check,
  X,
  Search,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { useProfile } from "@/hooks/use-profile";
import { listProjectGroups, addProjectToGroup } from "@/lib/project-groups.functions";
import { softDeleteProject } from "@/lib/trash.functions";
import { combineProjects } from "@/lib/project-actions.functions";
import { ProjectQrDialog } from "./ProjectQrDialog";

interface ProjectActionsMenuProps {
  project: {
    id: string;
    name: string;
    status: string;
    location: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    labels?: string[] | null;
  };
  photos: Array<{
    id: string;
    storage_path: string;
    caption: string | null;
    image_url?: string | null;
  }>;
  onEdit: () => void;
  onTrash: () => void;
  onDeleted: () => void;
  onStatusChange?: (status: string) => void;
  triggerClassName?: string;
}

/** Matches the section headings in GenerateDocumentMenu, the menu's neighbour in the header. */
const sectionLabel = "text-[10px] uppercase tracking-wide text-muted-foreground";

/**
 * One icon treatment for every non-destructive row.
 *
 * Two of these used to be `text-primary` and the rest inherited, which read as
 * two of the eight actions being highlighted for a reason nobody could name.
 * Destructive rows still differ - they take their colour from the item.
 */
const itemIcon = "mr-2 h-4 w-4 shrink-0 text-muted-foreground";

function projectAddress(project: ProjectActionsMenuProps["project"]) {
  return (
    [project.street, project.city, project.state, project.zip].filter(Boolean).join(", ") ||
    project.location
  );
}

function googleMapsUrl(project: ProjectActionsMenuProps["project"]) {
  if (project.latitude != null && project.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${project.latitude},${project.longitude}`;
  }
  const addr = projectAddress(project);
  if (!addr) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

/**
 * Title, plus an explanation only where one is worth the line.
 *
 * The same shape GenerateDocumentMenu uses - the two menus sit next to each
 * other in the project header, so they read as one system instead of two
 * different products - but `hint` is optional, and most items now go without.
 *
 * Every item used to carry a full sentence of grey text. Eight of those stacked
 * up is a dropdown taller than the viewport and a paragraph to read before you
 * can pick "Edit details", which is what client feedback meant by "it looks
 * crazy". A hint earns its line when the label alone would leave someone
 * guessing what the action destroys, publishes, or keeps - archive vs delete,
 * merge, the public QR link, the 60-day trash window. "Edit details" and
 * "Recently deleted" say everything about themselves already.
 */
function MenuText({
  title,
  hint,
  /**
   * Clamp the hint to one line.
   *
   * For a hint that is *data* rather than a sentence - the site address - a
   * second wrapped line buys nothing: the start of an address is what
   * identifies it, and the rest is what makes the row three lines tall. Prose
   * hints are written short enough to fit instead, so they never need this.
   */
  clampHint,
}: {
  title: string;
  hint?: string;
  clampHint?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block font-semibold">{title}</span>
      {hint && (
        <span
          className={cn(
            "block text-xs font-normal leading-snug text-muted-foreground",
            clampHint && "truncate",
          )}
        >
          {hint}
        </span>
      )}
    </span>
  );
}

/**
 * The project header's overflow menu.
 *
 * Deliberately *not* modelled on the reference app's version. Same practical
 * jobs - because those are what field crews actually need - but grouped by
 * intent (edit / organize / share / recovery) rather than one long list plus a
 * "danger zone", worded in our own vocabulary, and rendered with this app's
 * item style: a bold label, and a second line only where one is worth its
 * height (see MenuText). Trash and Delete live together under
 * "Recovery" because both are the same 60-day soft-delete lifecycle; splitting
 * them across the menu was the reference app's arrangement, not ours.
 */
export function ProjectActionsMenu({
  project,
  photos,
  onEdit,
  onTrash,
  onDeleted,
  onStatusChange,
  triggerClassName,
}: ProjectActionsMenuProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [combineOpen, setCombineOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Only for the printed QR sheet's letterhead - absent is fine, the sheet just
  // drops that line.
  const { profile } = useProfile();

  const listGroups = listProjectGroups;
  const addToGroup = addProjectToGroup;
  const doSoftDelete = softDeleteProject;
  const doCombine = combineProjects;

  const mapUrl = useMemo(() => googleMapsUrl(project), [project]);

  // ------------------------------------------------------------------
  // Group dialog
  // ------------------------------------------------------------------
  const [groups, setGroups] = useState<
    Array<{ id: string; name: string; description: string | null }>
  >([]);
  const [groupMemberships, setGroupMemberships] = useState<Set<string>>(new Set());
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupAdding, setGroupAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!groupOpen || !user) return;
    let cancelled = false;
    setGroupLoading(true);
    Promise.all([
      listGroups().then((res) => (res.groups as any[]) ?? []),
      (supabase as any)
        .from("project_group_members")
        .select("group_id")
        .eq("project_id", project.id),
    ])
      .then(([gRows, memRows]) => {
        if (cancelled) return;
        setGroups(
          gRows.map((g: any) => ({ id: g.id, name: g.name, description: g.description ?? null })),
        );
        setGroupMemberships(new Set(((memRows.data as any[]) ?? []).map((m) => m.group_id)));
      })
      .catch(() => toast.error("Failed to load groups"))
      .finally(() => setGroupLoading(false));
    return () => {
      cancelled = true;
    };
  }, [groupOpen, user, project.id, listGroups]);

  const filteredGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q),
    );
  }, [groups, groupQuery]);

  const handleAddToGroup = async (groupId: string) => {
    if (groupAdding || groupMemberships.has(groupId)) return;
    setGroupAdding(groupId);
    try {
      await addToGroup({ data: { groupId, projectId: project.id } });
      toast.success("Added to group");
      setGroupMemberships((s) => new Set(s).add(groupId));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add to group");
    } finally {
      setGroupAdding(null);
    }
  };

  // ------------------------------------------------------------------
  // Combine dialog
  // ------------------------------------------------------------------
  const [otherProjects, setOtherProjects] = useState<
    Array<{
      id: string;
      name: string;
      street: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
    }>
  >([]);
  const [combineQuery, setCombineQuery] = useState("");
  const [combineTarget, setCombineTarget] = useState<string | null>(null);
  const [combineLoading, setCombineLoading] = useState(false);

  useEffect(() => {
    if (!combineOpen || !user) return;
    let cancelled = false;
    setCombineLoading(true);
    (supabase as any)
      .from("projects")
      .select("id, name, street, city, state, zip")
      .eq("created_by", user.id)
      .is("deleted_at", null)
      .neq("id", project.id)
      .order("name", { ascending: true })
      .then(({ data, error }: any) => {
        if (cancelled) return;
        if (error) {
          toast.error(error.message);
          return;
        }
        setOtherProjects((data as any[]) ?? []);
      })
      .finally(() => setCombineLoading(false));
    return () => {
      cancelled = true;
    };
  }, [combineOpen, user, project.id]);

  const filteredProjects = useMemo(() => {
    const q = combineQuery.trim().toLowerCase();
    if (!q) return otherProjects;
    return otherProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        [p.street, p.city, p.state, p.zip].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [otherProjects, combineQuery]);

  const handleCombine = async () => {
    if (!combineTarget) return;
    const target = otherProjects.find((p) => p.id === combineTarget);
    if (!target) return;
    if (
      !(await confirm({
        description: `Merge “${project.name}” into “${target.name}”?\n\nAll photos, videos, tasks, documents, checklists, workflows, and walkthroughs will be moved to the target project. This project will be removed. This cannot be undone.`,
        variant: "destructive",
      }))
    )
      return;
    setBusy(true);
    try {
      const res = await doCombine({ data: { sourceId: project.id, targetId: combineTarget } });
      toast.success("Projects merged");
      setCombineOpen(false);
      navigate({ to: "/projects/$projectId", params: { projectId: (res as any).targetId } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not combine projects");
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // Archive / unarchive
  // ------------------------------------------------------------------
  const handleArchive = async () => {
    const nextStatus = project.status === "archived" ? "active" : "archived";
    const { error } = await (supabase as any)
      .from("projects")
      .update({ status: nextStatus })
      .eq("id", project.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onStatusChange?.(nextStatus);
    toast.success(nextStatus === "archived" ? "Project archived" : "Project unarchived");
    setOpen(false);
  };

  // ------------------------------------------------------------------
  // Download all photos
  // ------------------------------------------------------------------
  const downloadAllPhotos = async () => {
    if (photos.length === 0) {
      toast.error("No photos to download");
      return;
    }
    setBusy(true);
    const toastId = toast.loading(
      `Preparing ${photos.length} photo${photos.length === 1 ? "" : "s"}…`,
    );
    try {
      const zip = new JSZip();
      const folder = zip.folder(project.name.replace(/[^a-z0-9]/gi, "_") || "project");
      let completed = 0;
      let failed = 0;
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        try {
          const { data, error } = await supabase.storage
            .from("site-photos")
            .download(p.storage_path);
          if (error || !data) throw error ?? new Error("Download failed");
          const ext = (p.storage_path.split(".").pop() || "jpg").toLowerCase();
          const base = (p.caption ?? `photo-${i + 1}`).replace(/[^a-z0-9]/gi, "_").slice(0, 40);
          folder?.file(`${base}-${i + 1}.${ext}`, data);
          completed++;
        } catch {
          failed++;
        }
        if (i % 10 === 0) {
          toast.loading(`Downloaded ${completed} of ${photos.length}…`, { id: toastId });
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.name.replace(/[^a-z0-9]/gi, "_") || "project"}-photos.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast.dismiss(toastId);
      toast.success(
        `Downloaded ${completed} photo${completed === 1 ? "" : "s"}${failed > 0 ? ` · ${failed} failed` : ""}`,
      );
      setOpen(false);
    } catch (e: any) {
      toast.dismiss(toastId);
      toast.error(e?.message ?? "Could not download photos");
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // Delete project
  // ------------------------------------------------------------------
  const handleDelete = async () => {
    setBusy(true);
    try {
      await doSoftDelete({ data: { projectId: project.id } });
      toast.success("Project moved to Trash");
      setDeleteOpen(false);
      setOpen(false);
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete project");
    } finally {
      setBusy(false);
    }
  };

  const isArchived = project.status === "archived";

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={cn("h-9 w-9", triggerClassName)}
            aria-label="Project actions"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
          {/*
            No label over this first pair. "This project" restated the heading of
            the page the menu is attached to, and a section label above the very
            first item labels nothing - the two below it separate groups, which
            is the only job these do.
          */}
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <SquarePen className={itemIcon} />
            <MenuText title="Edit details" />
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              void handleArchive();
            }}
          >
            {isArchived ? (
              <ArchiveRestore className={itemIcon} />
            ) : (
              <Archive className={itemIcon} />
            )}
            {/* Keeps its hint: "archive" and "delete" are the pair people mix up. */}
            <MenuText
              title={isArchived ? "Move back to active" : "Move to archive"}
              hint={
                isArchived ? "Back on the active list" : "Keeps everything, off the active list"
              }
            />
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className={sectionLabel}>Organize</DropdownMenuLabel>

          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              setGroupOpen(true);
            }}
          >
            <FolderPlus className={itemIcon} />
            <MenuText title="File under a group" />
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              setCombineOpen(true);
            }}
          >
            <GitMerge className={itemIcon} />
            {/* Keeps its hint: it empties this project and cannot be undone. */}
            <MenuText
              title="Merge into another project"
              hint="Moves everything, empties this one"
            />
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className={sectionLabel}>Share &amp; export</DropdownMenuLabel>

          {mapUrl && (
            <DropdownMenuItem asChild>
              <a
                href={mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex cursor-pointer items-center"
              >
                <Navigation className={itemIcon} />
                {/* The address is the hint - pin-only projects simply go without. */}
                <MenuText
                  title="Open location in Maps"
                  hint={projectAddress(project) ?? undefined}
                  clampHint
                />
                <ExternalLink className="ml-2 h-3 w-3 shrink-0 opacity-50" />
              </a>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              setQrOpen(true);
            }}
          >
            <QrCode className={itemIcon} />
            {/*
              Keeps its hint, and the hint is the whole point: this code now
              resolves without a login, so the person clicking needs to know
              that before they print it and tape it to a door.
            */}
            <MenuText title="QR code for this job" hint="Anyone can scan it - no sign-in" />
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              void downloadAllPhotos();
            }}
            disabled={photos.length === 0}
          >
            <FileArchive className={itemIcon} />
            <MenuText
              title="Export photos as ZIP"
              hint={
                photos.length === 0
                  ? "No photos yet"
                  : `${photos.length} photo${photos.length === 1 ? "" : "s"}, original quality`
              }
            />
          </DropdownMenuItem>

          {/* Google Calendar integration is not implemented yet; hidden per user request. */}

          <DropdownMenuSeparator />
          {/*
            Trash and Delete belong to the same 60-day soft-delete lifecycle, so
            they sit together instead of being split between the main list and a
            separate "danger zone" at the bottom. The window is stated once, on
            Delete - repeating it on both items was the same sentence twice.
          */}
          <DropdownMenuLabel className={sectionLabel}>Recovery</DropdownMenuLabel>

          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onTrash();
            }}
          >
            <History className={itemIcon} />
            <MenuText title="Recently deleted" />
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              setDeleteOpen(true);
            }}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="block font-semibold">Delete this project</span>
              <span className="block text-xs font-normal leading-snug text-destructive/70">
                Goes to Trash - recoverable for 60 days
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        Mounted only once opened - it fetches the project's link state, which is
        not work the project header should do on every render.
      */}
      {qrOpen && (
        <ProjectQrDialog
          open={qrOpen}
          onOpenChange={setQrOpen}
          projectId={project.id}
          projectName={project.name}
          projectAddress={projectAddress(project)}
          companyName={profile?.company ?? null}
        />
      )}

      {/* File under a group dialog */}
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>File under a group</DialogTitle>
            <DialogDescription>
              File “{project.name}” under an existing group. You can create new groups from the
              dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search groups…"
                value={groupQuery}
                onChange={(e) => setGroupQuery(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
            <ScrollArea className="h-64 rounded-md border border-border">
              {groupLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : filteredGroups.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {groups.length === 0 ? "No project groups yet." : "No groups match your search."}
                </p>
              ) : (
                <div className="p-1">
                  {filteredGroups.map((g) => {
                    const isMember = groupMemberships.has(g.id);
                    return (
                      <div
                        key={g.id}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{g.name}</p>
                          {g.description && (
                            <p className="truncate text-xs text-muted-foreground">
                              {g.description}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={isMember ? "secondary" : "outline"}
                          className="h-7 shrink-0 text-xs"
                          disabled={isMember || groupAdding === g.id}
                          onClick={() => void handleAddToGroup(g.id)}
                        >
                          {groupAdding === g.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : isMember ? (
                            <Check className="mr-1 h-3 w-3" />
                          ) : null}
                          {isMember ? "Added" : "Add"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGroupOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge into another project dialog */}
      <Dialog open={combineOpen} onOpenChange={setCombineOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge into another project</DialogTitle>
            <DialogDescription>
              Move all data from “{project.name}” into another project. The source project will be
              removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search projects…"
                value={combineQuery}
                onChange={(e) => setCombineQuery(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
            <ScrollArea className="h-64 rounded-md border border-border">
              {combineLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : filteredProjects.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {otherProjects.length === 0
                    ? "No other projects to combine with."
                    : "No projects match your search."}
                </p>
              ) : (
                <div className="p-1">
                  {filteredProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setCombineTarget(p.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition ${
                        combineTarget === p.id ? "bg-primary/10 text-primary" : "hover:bg-accent"
                      }`}
                    >
                      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current">
                        {combineTarget === p.id && (
                          <span className="h-2 w-2 rounded-full bg-current" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        {(() => {
                          const addr = [p.street, p.city, p.state, p.zip]
                            .filter(Boolean)
                            .join(", ");
                          return addr ? (
                            <p className="truncate text-xs text-muted-foreground">{addr}</p>
                          ) : null;
                        })()}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setCombineOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!combineTarget || busy}
              onClick={() => void handleCombine()}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Merge into selected project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete this project
            </DialogTitle>
            <DialogDescription>
              Move “{project.name}” to Trash? All photos, reports, tasks, and checklists will be
              hidden. The project will be permanently deleted after 60 days, but you can restore it
              from Trash before then.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={busy}>
              <X className="mr-1.5 h-4 w-4" />
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void handleDelete()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
