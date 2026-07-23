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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { supabase } from "@/integrations/sitepix/client";
import { softDeleteProject } from "@/lib/trash.functions";
import { toast } from "sonner";
import { MapPin, Trash2 } from "lucide-react";

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
  });
  const [saving, setSaving] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const navigate = useNavigate();
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
      status: form.status,
    };
    const { error } = await supabase
      .from("projects")
      .update(patch as any)
      .eq("id", project.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Project updated");
    onSaved({ ...project, ...patch });
    onOpenChange(false);
  };

  const moveToTrash = async () => {
    if (
      !window.confirm(
        "Move this entire project to Trash?\n\nAll photos, reports, tasks, and checklists will be hidden. The project will be permanently deleted after 60 days. You can restore it from the Trash any time before then.",
      )
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
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger id="ep-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_hold">On hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
