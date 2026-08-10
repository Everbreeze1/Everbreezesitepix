import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Wand2,
  Plus,
  Loader2,
  ImageOff,
  Check,
  X,
  Mic,
  MicOff,
  Printer,
  Trash2,
  ClipboardList,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/sitepix/client";
import { useConfirm } from "@/hooks/use-confirm";
import { summarizePhotosReport, describeSiteLogPhotos } from "@/lib/ai.functions";
import { generateSiteLogPdf } from "@/lib/site-log-pdf.functions";
import { cleanCaption } from "@sitepix/shared";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";

interface Photo {
  id: string;
  caption: string | null;
  project_id: string;
  storage_path: string;
  taken_at: string | null;
}
interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}
interface PhotoNote {
  notes: string;
  todos: TodoItem[];
}
interface SiteLogRow {
  id: string;
  project_id: string;
  title: string;
  photo_ids: string[];
  notes: Record<string, PhotoNote>;
  created_at: string;
  updated_at: string;
}

interface Props {
  projectId: string;
  projectName: string;
}

export function ProjectSiteLogs({ projectId, projectName }: Props) {
  const confirm = useConfirm();
  const [logs, setLogs] = useState<SiteLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<SiteLogRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("project_site_logs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) toast.error("Couldn't load site logs", { description: error.message });
    setLogs((data ?? []) as SiteLogRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [projectId]);

  const openNew = () => {
    setEditing(null);
    setBuilderOpen(true);
  };
  const openEdit = (log: SiteLogRow) => {
    setEditing(log);
    setBuilderOpen(true);
  };

  const handleDelete = async (log: SiteLogRow) => {
    if (
      !(await confirm({ description: `Delete site log "${log.title}"?`, variant: "destructive" }))
    )
      return;
    const { error } = await (supabase as any).from("project_site_logs").delete().eq("id", log.id);
    if (error) {
      toast.error("Couldn't delete", { description: error.message });
      return;
    }
    setLogs((ls) => ls.filter((l) => l.id !== log.id));
    toast.success("Site log deleted");
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Site Logs</h2>
            {logs.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {logs.length}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            AI-drafted daily recaps built from this project's photos. Add notes and action items,
            then export a PDF.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Wand2 className="mr-1 h-4 w-4" /> New site log
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No site logs yet"
          description="Pick a few photos and AI will draft a professional site log automatically."
          action={
            <Button size="sm" onClick={openNew}>
              <Wand2 className="mr-1 h-4 w-4" /> New site log
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {logs.map((l) => (
            <li key={l.id}>
              <Card className="group flex h-full flex-col p-4 transition hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => openEdit(l)} className="min-w-0 flex-1 text-left">
                    <p className="truncate font-medium hover:underline">{l.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleDateString()} · {l.photo_ids.length} photo
                      {l.photo_ids.length === 1 ? "" : "s"}
                    </p>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Site log actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(l)}>Open</DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(l)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {builderOpen && (
        <SiteLogBuilder
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          projectId={projectId}
          projectName={projectName}
          existing={editing}
          onSaved={(row) => {
            setLogs((prev) => {
              const idx = prev.findIndex((r) => r.id === row.id);
              if (idx >= 0) {
                const cp = prev.slice();
                cp[idx] = row;
                return cp;
              }
              return [row, ...prev];
            });
          }}
        />
      )}
    </section>
  );
}

/* --------------- Builder Dialog --------------- */

function SiteLogBuilder({
  open,
  onOpenChange,
  projectId,
  projectName,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  projectName: string;
  existing: SiteLogRow | null;
  onSaved: (row: SiteLogRow) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.photo_ids ?? []));
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState(
    existing?.title ?? `${projectName} — ${new Date().toLocaleDateString()}`,
  );
  const [notes, setNotes] = useState<Record<string, PhotoNote>>(existing?.notes ?? {});
  const [stage, setStage] = useState<"pick" | "edit">(existing ? "edit" : "pick");
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const sumPhotos = summarizePhotosReport;
  const describePhotos = describeSiteLogPhotos;
  const buildPdf = generateSiteLogPdf;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ps } = await supabase
        .from("photos")
        .select("id, caption, project_id, storage_path, taken_at")
        .eq("project_id", projectId)
        // Trashed photos are soft-deleted with no database-level enforcement.
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      const list = (ps as Photo[]) ?? [];
      setPhotos(list);
      // One batch request instead of up to 500 concurrent ones — the fan-out
      // was enough to saturate the browser's connection pool and stall the
      // rest of the page's requests behind it.
      const sig: Record<string, string> = {};
      const signable = list.filter((p) => !!p.storage_path);
      if (signable.length) {
        const { data: signed } = await supabase.storage.from("site-photos").createSignedUrls(
          signable.map((p) => p.storage_path),
          3600,
        );
        signed?.forEach((s, i) => {
          if (s.signedUrl) sig[signable[i].id] = s.signedUrl;
        });
      }
      if (!cancelled) {
        setSigned(sig);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedPhotos = useMemo(
    () =>
      Array.from(selected)
        .map((id) => photos.find((p) => p.id === id))
        .filter(Boolean) as Photo[],
    [selected, photos],
  );

  const generate = async () => {
    if (selected.size === 0) {
      toast.error("Select at least one photo");
      return;
    }
    setGenerating(true);
    try {
      const ids = Array.from(selected);
      const [, desc] = await Promise.all([
        sumPhotos({ data: { photoIds: ids, title } }).catch(() => null),
        describePhotos({ data: { photoIds: ids } }).catch(() => ({
          notes: {} as Record<string, string>,
        })),
      ]);
      const init: Record<string, PhotoNote> = {};
      for (const id of ids) {
        init[id] = notes[id] ?? { notes: desc.notes?.[id] ?? "", todos: [] };
      }
      setNotes(init);

      // Persist immediately so the log appears in the list.
      const payload = {
        project_id: projectId,
        title: title || "Site Log",
        photo_ids: ids,
        notes: init,
      };
      const q = savedId
        ? (supabase as any)
            .from("project_site_logs")
            .update(payload)
            .eq("id", savedId)
            .select("*")
            .single()
        : (supabase as any).from("project_site_logs").insert(payload).select("*").single();
      const { data, error } = await q;
      if (error || !data) throw new Error(error?.message ?? "Could not save site log");
      setSavedId(data.id);
      onSaved(data as SiteLogRow);
      setStage("edit");
      toast.success(`Site log drafted from ${ids.length} photo${ids.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate site log");
    } finally {
      setGenerating(false);
    }
  };

  const persist = async (opts?: { closeAfter?: boolean }) => {
    if (!savedId) return;
    setSaving(true);
    const { data, error } = await (supabase as any)
      .from("project_site_logs")
      .update({
        title: title || "Site Log",
        photo_ids: Array.from(selected),
        notes,
      })
      .eq("id", savedId)
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error("Couldn't save", { description: error?.message });
      return;
    }
    onSaved(data as SiteLogRow);
    toast.success("Site log saved", { description: "Your changes are safe." });
    if (opts?.closeAfter !== false) {
      onOpenChange(false);
    }
  };

  const addTodo = (photoId: string, text: string) => {
    if (!text.trim()) return;
    setNotes((n) => ({
      ...n,
      [photoId]: {
        notes: n[photoId]?.notes ?? "",
        todos: [
          ...(n[photoId]?.todos ?? []),
          { id: crypto.randomUUID(), text: text.trim(), done: false },
        ],
      },
    }));
  };
  const toggleTodo = (photoId: string, todoId: string) =>
    setNotes((n) => ({
      ...n,
      [photoId]: {
        notes: n[photoId]?.notes ?? "",
        todos: (n[photoId]?.todos ?? []).map((t) =>
          t.id === todoId ? { ...t, done: !t.done } : t,
        ),
      },
    }));
  const removeTodo = (photoId: string, todoId: string) =>
    setNotes((n) => ({
      ...n,
      [photoId]: {
        notes: n[photoId]?.notes ?? "",
        todos: (n[photoId]?.todos ?? []).filter((t) => t.id !== todoId),
      },
    }));
  const setPhotoNotes = (photoId: string, text: string) =>
    setNotes((n) => ({ ...n, [photoId]: { notes: text, todos: n[photoId]?.todos ?? [] } }));

  const exportPdf = async () => {
    if (selectedPhotos.length === 0) {
      toast.error("No photos to export");
      return;
    }
    setExporting(true);
    try {
      const items = selectedPhotos.map((p) => {
        const n = notes[p.id] ?? { notes: "", todos: [] };
        return {
          photoId: p.id,
          notes: n.notes ?? "",
          todos: (n.todos ?? []).map((t) => ({ text: t.text, done: t.done })),
        };
      });
      const res = await buildPdf({ data: { title: title || "Site Log", items } });
      const bin = atob(res.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("Site log exported", { description: res.filename });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not export PDF");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            {stage === "pick" ? "New site log" : "Edit site log"}
          </DialogTitle>
        </DialogHeader>

        {stage === "pick" ? (
          <div className="flex flex-col gap-3 p-5">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Site log title"
            />
            <ScrollArea className="h-[52vh] rounded-md border">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : photos.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No photos in this project yet.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 md:grid-cols-5">
                  {photos.map((p) => {
                    const sel = selected.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggle(p.id)}
                        className={`group relative aspect-square overflow-hidden rounded-md border-2 transition ${sel ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-border"}`}
                      >
                        {signed[p.id] ? (
                          <img src={signed[p.id]} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-muted">
                            <ImageOff className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        {sel && (
                          <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            <DialogFooter>
              <span className="mr-auto text-xs text-muted-foreground">
                {selected.size} selected
              </span>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={generate} disabled={generating || selected.size === 0}>
                {generating ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-1.5 h-4 w-4" />
                )}
                Generate site log
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-center gap-2 border-b border-border px-5 py-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="max-w-md"
              />
              <div className="ml-auto flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void persist()}
                  disabled={saving}
                >
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Save
                </Button>

                <Button size="sm" onClick={exportPdf} disabled={exporting}>
                  {exporting ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="mr-1.5 h-4 w-4" />
                  )}
                  Export PDF
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="mx-auto max-w-6xl p-5">
                <label className="mb-3 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Photos, notes & action items
                </label>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {selectedPhotos.map((p, i) => (
                    <PhotoNoteBlock
                      key={p.id}
                      index={i + 1}
                      photo={p}
                      signedUrl={signed[p.id]}
                      note={notes[p.id] ?? { notes: "", todos: [] }}
                      onNotesChange={(t) => setPhotoNotes(p.id, t)}
                      onAddTodo={(t) => addTodo(p.id, t)}
                      onToggleTodo={(id) => toggleTodo(p.id, id)}
                      onRemoveTodo={(id) => removeTodo(p.id, id)}
                    />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PhotoNoteBlock({
  index,
  photo,
  signedUrl,
  note,
  onNotesChange,
  onAddTodo,
  onToggleTodo,
  onRemoveTodo,
}: {
  index: number;
  photo: Photo;
  signedUrl?: string;
  note: PhotoNote;
  onNotesChange: (t: string) => void;
  onAddTodo: (t: string) => void;
  onToggleTodo: (id: string) => void;
  onRemoveTodo: (id: string) => void;
}) {
  const [todo, setTodo] = useState("");
  const cap = cleanCaption(photo.caption);
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:border-primary/40 hover:shadow-md">
      <div className="grid grid-cols-[140px_1fr] gap-3 p-3">
        <div className="relative aspect-square w-[140px] overflow-hidden rounded-md bg-muted">
          {signedUrl ? (
            <img src={signedUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImageOff className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <span className="absolute left-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary-foreground shadow">
            #{index}
          </span>
        </div>
        <div className="min-w-0">
          {cap && (
            <div className="mb-1 truncate text-xs font-semibold text-foreground/80" title={cap}>
              {cap}
            </div>
          )}
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            AI notes
          </label>
          <Textarea
            value={note.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="AI-generated notes will appear here. Editable."
            className="min-h-[110px] resize-y border-border/60 text-sm leading-relaxed"
          />
        </div>
      </div>
      <div className="border-t border-border/60 p-3">
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Action items
        </label>
        {note.todos.length > 0 && (
          <div className="mb-2 space-y-1 rounded-md border border-border/60 bg-muted/30 p-2">
            {note.todos.map((t) => (
              <div key={t.id} className="group flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => onToggleTodo(t.id)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${t.done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary"}`}
                >
                  {t.done && <Check className="h-3 w-3" />}
                </button>
                <span
                  className={`flex-1 ${t.done ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {t.text}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveTodo(t.id)}
                  className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <TodoInput
          value={todo}
          onChange={setTodo}
          onSubmit={() => {
            onAddTodo(todo);
            setTodo("");
          }}
        />
      </div>
    </div>
  );
}

function TodoInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const supported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const startDictation = () => {
    if (!supported) {
      toast.error("Voice input isn't supported in this browser");
      return;
    }
    try {
      const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const rec = new Ctor();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = value;
      rec.onresult = (e: any) => {
        let interim = "";
        let finals = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (finals) finalText = (finalText ? finalText.trim() + " " : "") + finals.trim();
        onChange((finalText + (interim ? " " + interim : "")).trim());
      };
      rec.onerror = () => {
        setListening(false);
        toast.error("Couldn't hear you — try again");
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      toast.error("Voice input failed to start");
    }
  };
  const stopDictation = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (listening) stopDictation();
        onSubmit();
      }}
      className="flex items-center gap-2"
    >
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={listening ? "Listening…" : "Add an action item…"}
        className="h-10 border-border/60 bg-background text-sm"
      />
      {supported && (
        <Button
          type="button"
          size="icon"
          variant={listening ? "default" : "outline"}
          onClick={listening ? stopDictation : startDictation}
          className="h-10 w-10 shrink-0"
          aria-label={listening ? "Stop dictation" : "Dictate action item"}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
      )}
      <Button type="submit" size="icon" className="h-10 w-10 shrink-0" aria-label="Add action item">
        <Plus className="h-4 w-4" />
      </Button>
    </form>
  );
}
