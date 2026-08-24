import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { supabase } from "@/integrations/everlumen/client";
import { useConfirm } from "@/hooks/use-confirm";
import { softDeleteProject } from "@/lib/trash.functions";
import { toast } from "sonner";
import { MapPin, Trash2 } from "lucide-react";
import { writeWithNewColumns, PROJECT_CLIENT_KEYS } from "@/lib/merge-field-columns";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { qk } from "@/lib/query-keys";
import { listProjectBoards, setProjectPipelineStage } from "@/lib/project-boards.functions";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@everlumen/shared";

/** The Select's stand-in for NULL: Radix reserves the empty string. */
const NO_STAGE = "__none__";

export interface EditableProject {
  id: string;
  name: string;
  description: string | null;
  location?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: string;
  /**
   * Where the project is in its pipeline. One value, always: this is the field
   * that replaced the tag-per-column pipelines, so setting it here and dragging
   * the card on the board are the same single write. Optional because a
   * database that predates 20260917000000_pipeline_stages.sql will not return
   * it.
   */
  pipeline_stage_id?: string | null;
  /*
   * Merge fields. Every document template asks for these, and before they had
   * a home here the "Use in a project" step asked for them again on every
   * document for the same job. Optional because a database that predates
   * 20260823000000_project_client_fields.sql simply will not return them.
   */
  client_name?: string | null;
  client_contact?: string | null;
  project_number?: string | null;
}

interface Props {
  project: EditableProject;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (next: EditableProject) => void;
}

export function EditProjectDialog({ project, open, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? "",
    location: project.location ?? "",
    street: project.street ?? "",
    city: project.city ?? "",
    state: project.state ?? "",
    zip: project.zip ?? "",
    latitude: project.latitude ?? (null as number | null),
    longitude: project.longitude ?? (null as number | null),
    status: project.status,
    pipeline_stage_id: project.pipeline_stage_id ?? null,
    client_name: project.client_name ?? "",
    client_contact: project.client_contact ?? "",
    project_number: project.project_number ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const { user } = useAuth();

  /*
   * The stage list comes from the team's pipelines rather than a fixed enum,
   * because stages are editable per board. Grouped by pipeline in the dropdown
   * so "In Progress" on two different boards is still two distinct choices.
   */
  const boardsQuery = useQuery({
    queryKey: qk.projectBoards(user?.id ?? ""),
    queryFn: async () => (await listProjectBoards()).boards,
    enabled: open && !!user,
    staleTime: 60_000,
  });
  const boards = boardsQuery.data ?? [];
  const hasStages = boards.some((b) => b.stages.length > 0);

  /*
   * This form is the third place that used to offer both statuses at once, and
   * the only one that could write them in the same submit. The stage owns the
   * bucket (see packages/shared/src/pipeline-stages.ts), so where the form has
   * a stage the Status select shows what that stage counts as and stops being
   * editable, and the save leaves `status` out of the patch entirely - the
   * stage write below sets it.
   */
  const selectedStage = form.pipeline_stage_id
    ? boards.flatMap((b) => b.stages).find((s) => s.id === form.pipeline_stage_id)
    : undefined;
  const stageOwnsStatus = !!selectedStage;
  const shownStatus = selectedStage ? selectedStage.status : form.status;
  const navigate = useNavigate();
  const confirm = useConfirm();
  const trash = softDeleteProject;

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const patch = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      street: form.street.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      zip: form.zip.trim() || null,
      latitude: form.latitude,
      longitude: form.longitude,
      // Omitted where a stage decides it, so this save cannot contradict the
      // stage write that follows.
      ...(stageOwnsStatus ? {} : { status: form.status }),
      client_name: form.client_name.trim() || null,
      client_contact: form.client_contact.trim() || null,
      project_number: form.project_number.trim() || null,
    };
    // Retried without the client columns if this database predates them, so a
    // rename does not fail because of a field the user never touched.
    const { error } = await writeWithNewColumns(
      patch,
      PROJECT_CLIENT_KEYS,
      (row) =>
        supabase
          .from("projects")
          .update(row as any)
          .eq("id", project.id),
      "Saved without the client details",
    );
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }

    // Separate write on purpose: it goes through the same validated op the
    // board's drag uses, and it keeps the stage out of the retry above, which
    // exists for databases missing the client columns.
    const nextStage = form.pipeline_stage_id;
    if (nextStage !== (project.pipeline_stage_id ?? null)) {
      try {
        await setProjectPipelineStage({
          data: { projectId: project.id, stageId: nextStage },
        });
      } catch (e: any) {
        setSaving(false);
        toast.error(e?.message ?? "Saved, but could not change the pipeline stage");
        onSaved({ ...project, ...patch });
        return;
      }
    }

    setSaving(false);
    toast.success("Project updated");
    // `shownStatus` rather than the patch's: where a stage decided it, the
    // patch does not carry a status at all, and the caller still has to repaint
    // its header with the one the stage just wrote.
    onSaved({ ...project, ...patch, status: shownStatus, pipeline_stage_id: nextStage });
    onOpenChange(false);
  };

  const moveToTrash = async () => {
    if (
      !(await confirm({
        description:
          "Move this entire project to Trash?\n\nAll photos, reports, tasks, and checklists will be hidden. The project will be permanently deleted after 60 days. You can restore it from the Trash any time before then.",
        variant: "destructive",
      }))
    )
      return;
    setTrashing(true);
    try {
      await trash({ data: { projectId: project.id } });
      toast.success("Project moved to Trash");
      onOpenChange(false);
      navigate({ to: "/projects" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to move to trash");
    } finally {
      setTrashing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ep-name">Project name</Label>
            <Input
              id="ep-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-status">Status</Label>
            <Select
              value={shownStatus}
              onValueChange={(v) => setForm({ ...form, status: v })}
              disabled={stageOwnsStatus}
            >
              <SelectTrigger id="ep-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stageOwnsStatus && (
              <p className="text-xs leading-snug text-muted-foreground">
                Set by the stage below. {selectedStage!.name} counts as{" "}
                {PROJECT_STATUS_LABELS[shownStatus as (typeof PROJECT_STATUSES)[number]] ??
                  shownStatus}
                , which is what the map and the project filters read.
              </p>
            )}
          </div>

          {hasStages && (
            <div className="space-y-1.5">
              <Label htmlFor="ep-stage">Pipeline stage</Label>
              <Select
                value={form.pipeline_stage_id ?? NO_STAGE}
                onValueChange={(v) =>
                  setForm({ ...form, pipeline_stage_id: v === NO_STAGE ? null : v })
                }
              >
                <SelectTrigger id="ep-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STAGE}>Not in a pipeline</SelectItem>
                  {boards
                    .filter((b) => b.stages.length > 0)
                    .map((b) => (
                      <SelectGroup key={b.id}>
                        <SelectLabel>{b.name}</SelectLabel>
                        {[...b.stages]
                          .sort((x, y) => x.position - y.position)
                          .map((st) => (
                            <SelectItem key={st.id} value={st.id}>
                              {st.name}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Where the job is in the process, one stage at a time. The stage sets the status
                above, so the two can never say different things.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ep-loc">Address search</Label>
            <AddressAutocomplete
              id="ep-loc"
              value={form.location}
              onChange={(v) => setForm((f) => ({ ...f, location: v }))}
              onSelect={(addr) =>
                setForm((f) => ({
                  ...f,
                  location: addr.formatted,
                  street: addr.street,
                  city: addr.city,
                  state: addr.state,
                  zip: addr.zip,
                  latitude: addr.latitude,
                  longitude: addr.longitude,
                }))
              }
              placeholder="Search to auto-fill, or edit fields below"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="ep-street"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Street
            </Label>
            <Input
              id="ep-street"
              value={form.street}
              onChange={(e) => setForm({ ...form, street: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 space-y-1.5 sm:col-span-6">
              <Label
                htmlFor="ep-city"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                City
              </Label>
              <Input
                id="ep-city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="col-span-5 space-y-1.5 sm:col-span-2">
              <Label
                htmlFor="ep-state"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                State
              </Label>
              <Input
                id="ep-state"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                maxLength={3}
              />
            </div>
            <div className="col-span-7 space-y-1.5 sm:col-span-4">
              <Label
                htmlFor="ep-zip"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Zip
              </Label>
              <Input
                id="ep-zip"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                inputMode="numeric"
              />
            </div>
          </div>

          {form.latitude != null && form.longitude != null && (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              GPS: {Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}
            </p>
          )}

          {/* Merge fields. Filled in once here, they stop every document
              created for this job asking for them again. */}
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Client &amp; job details
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                fill documents in automatically
              </span>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ep-client">Client name</Label>
              <Input
                id="ep-client"
                value={form.client_name}
                placeholder="e.g. Sarah Whitfield"
                onChange={(e) => setForm({ ...form, client_name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ep-client-contact">Client contact</Label>
                <Input
                  id="ep-client-contact"
                  value={form.client_contact}
                  placeholder="Email or phone"
                  onChange={(e) => setForm({ ...form, client_contact: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ep-number">Project number</Label>
                <Input
                  id="ep-number"
                  value={form.project_number}
                  placeholder="e.g. PRJ-00421"
                  onChange={(e) => setForm({ ...form, project_number: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-desc">Description</Label>
            <Textarea
              id="ep-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={moveToTrash}
            disabled={trashing || saving}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {trashing ? "Moving…" : "Move to Trash"}
          </Button>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
