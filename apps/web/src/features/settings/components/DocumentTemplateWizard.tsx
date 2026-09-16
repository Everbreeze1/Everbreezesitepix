import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, GripVertical, Loader2, Plus, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CATEGORY_ORDER, GENERAL_CATEGORY } from "@/lib/template-categories";
import { restrictToVerticalAxis } from "@/components/builder/builder-tokens";

/* ------------------------------------------------------------------ model */

/** The click-to-insert tokens the mockup's Sections step offers. */
const TOKENS = [
  { token: "project_name", label: "Project name" },
  { token: "project_address", label: "Project address" },
  { token: "author_name", label: "Author name" },
  { token: "report_date", label: "Report date" },
  { token: "photo_count", label: "Photo count" },
] as const;

const COVERS = [
  { key: "minimal", label: "Minimal", hint: "Clean title on a plain page." },
  { key: "centered", label: "Centered", hint: "Large centered title with subtitle." },
  { key: "hero", label: "Hero band", hint: "Bold colored hero band on top." },
  { key: "photo", label: "Photo cover", hint: "Full-bleed cover photo with overlay." },
] as const;

type CoverKey = (typeof COVERS)[number]["key"];

/** The kind chip on a section card, mirroring the mockup's "Text + photos" etc. */
type SectionKind = "text" | "text_photos" | "photo_grid" | "checklist";
const SECTION_KIND_LABEL: Record<SectionKind, string> = {
  text: "Text only",
  text_photos: "Text + photos",
  photo_grid: "Photo grid",
  checklist: "Checklist recap",
};

interface Section {
  id: string;
  heading: string;
  body: string;
  kind: SectionKind;
}

let sectionSeq = 0;
const makeSection = (heading: string, body: string, kind: SectionKind): Section => ({
  id: "wz-sec-" + ++sectionSeq,
  heading,
  body,
  kind,
});

/** The finished template, handed back to DocumentTemplatesManager to save. */
export interface DocumentWizardPayload {
  name: string;
  description: string;
  category: string;
  html: string;
  fields: string[];
}

export interface DocumentTemplateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: DocumentWizardPayload) => Promise<boolean>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The placeholder tokens a body actually uses - the set that must resolve. */
function detectFields(bodies: string[]): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
  for (const body of bodies) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) set.add(m[1].toLowerCase());
  }
  return Array.from(set).sort();
}

/** Substitute token labels so the preview reads like a finished document. */
function samplePreview(body: string): string {
  let out = body;
  for (const t of TOKENS) {
    out = out.replace(new RegExp("\\{\\{\\s*" + t.token + "\\s*\\}\\}", "gi"), t.label);
  }
  out = out.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, "…");
  return out.trim();
}
/* ------------------------------------------------------------ component */

export function DocumentTemplateWizard({
  open,
  onOpenChange,
  onSave,
}: DocumentTemplateWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [category, setCategory] = useState<string>(GENERAL_CATEGORY);
  const [cover, setCover] = useState<CoverKey>("hero");
  const [sections, setSections] = useState<Section[]>([
    makeSection(
      "Executive summary",
      "Overview of the work for {{project_name}} on {{report_date}}.",
      "text",
    ),
    makeSection("Observations", "Notes from the crew, plus supporting photos.", "text_photos"),
    makeSection("Photos", "All photos tagged to this visit, in a grid.", "photo_grid"),
  ]);
  const [extraFields, setExtraFields] = useState<string[]>([]);
  /** Offered tokens the author took off the list (unused ones only stay off). */
  const [removed, setRemoved] = useState<string[]>([]);
  const [newField, setNewField] = useState("");
  const [insertTarget, setInsertTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* Reset whenever the dialog opens fresh. */
  useEffect(() => {
    if (open) {
      setStep(1);
      setName("");
      setSubtitle("");
      setCategory(GENERAL_CATEGORY);
      setCover("hero");
      setSections([
        makeSection(
          "Executive summary",
          "Overview of the work for {{project_name}} on {{report_date}}.",
          "text",
        ),
        makeSection("Observations", "Notes from the crew, plus supporting photos.", "text_photos"),
        makeSection("Photos", "All photos tagged to this visit, in a grid.", "photo_grid"),
      ]);
      setExtraFields([]);
      setRemoved([]);
      setNewField("");
      setInsertTarget(null);
    }
  }, [open]);

  const placeholders = useMemo(() => {
    const set = new Set<string>(extraFields);
    for (const t of TOKENS) set.add(t.token);
    for (const s of sections) {
      const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s.body))) set.add(m[1].toLowerCase());
    }
    return Array.from(set).sort();
  }, [extraFields, sections]);

  /* The chips the mockup draws, minus anything taken off the list. */
  const offeredPlaceholders = useMemo(
    () => placeholders.filter((p) => !removed.includes(p)),
    [placeholders, removed],
  );

  /** Clicking a token drops `{{token}}` at the caret of the last focused section. */
  const insertToken = (token: string) => {
    const fallback = sections[0]?.id ?? null;
    if (!fallback) return;
    const id =
      insertTarget && sections.some((s) => s.id === insertTarget) ? insertTarget : fallback;
    setInsertTarget(id);
    const needle = "{{" + token + "}}";
    setSections((xs) =>
      xs.map((s) => {
        if (s.id !== id) return s;
        const el = textareaRefs.current[id];
        const value = el?.value ?? s.body;
        const start = typeof el?.selectionStart === "number" ? el.selectionStart : value.length;
        const end = typeof el?.selectionEnd === "number" ? el.selectionEnd : start;
        const next = value.slice(0, start) + needle + value.slice(end);
        requestAnimationFrame(() => {
          const n = textareaRefs.current[id];
          if (n) {
            n.focus();
            const caret = start + needle.length;
            n.setSelectionRange(caret, caret);
          }
        });
        return { ...s, body: next };
      }),
    );
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = sections.findIndex((s) => s.id === active.id);
    const to = sections.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    setSections((xs) => arrayMove(xs, from, to));
  };

  const addSection = () => {
    setSections((xs) => [...xs, makeSection("", "", "text")]);
    setInsertTarget(null);
  };

  const updateSection = (id: string, patch: Partial<Section>) =>
    setSections((xs) => xs.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeField = (token: string) => {
    setExtraFields((xs) => xs.filter((x) => x !== token));
    setRemoved((xs) => (xs.includes(token) ? xs : [...xs, token]));
  };

  const addField = () => {
    const t = newField
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_");
    if (!t) return;
    // Adding it back is the undo for having taken it off.
    setRemoved((xs) => xs.filter((x) => x !== t));
    if (!extraFields.includes(t)) setExtraFields((xs) => [...xs, t]);
    setNewField("");
  };

  const buildHtml = (): string => {
    const esc = escapeHtml;
    let coverBlock: string;
    switch (cover) {
      case "centered":
        coverBlock = `<p style="text-align:center;padding:44px 0 8px;"><span style="font-size:32px">${esc(name)}</span>${subtitle.trim() ? `<br/><span style="font-size:16px;color:#6b7280">${esc(subtitle)}</span>` : ""}</p>`;
        break;
      case "hero":
        coverBlock = `<div style="background:#22262b;color:#fff;padding:36px 32px;"><h1 style="font-size:30px;margin:0">${esc(name)}</h1>${subtitle.trim() ? `<p style="margin:6px 0 0;opacity:.85">${esc(subtitle)}</p>` : ""}</div>`;
        break;
      case "photo":
        coverBlock = `<div style="background:linear-gradient(160deg,#3b3f46,#23262b);color:#fff;padding:44px 32px;text-align:center;"><h1 style="font-size:30px;margin:0">${esc(name)}</h1>${subtitle.trim() ? `<p style="margin:6px 0 0;opacity:.8">${esc(subtitle)}</p>` : ""}</div>`;
        break;
      default:
        coverBlock = `<h1>${esc(name)}</h1>${subtitle.trim() ? `<p>${esc(subtitle)}</p>` : ""}`;
    }
    const body = sections
      .filter((s) => s.heading.trim() || s.body.trim())
      .map((s) => `<h2>${esc(s.heading)}</h2>` + (s.body.trim() ? `<p>${s.body}</p>` : ""))
      .join("");
    return `${coverBlock}${body}`;
  };

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    // Only the tokens the body actually uses, plus anything the author added
    // by hand - the same rule the editor applies, so the fill-in step never
    // asks for a blank the document does not have. A token taken off the list
    // still lands here when a section uses it, because the body needs it.
    const fields = Array.from(
      new Set([...detectFields(sections.map((s) => s.body)), ...extraFields]),
    ).sort();
    const ok = await onSave({
      name,
      description: subtitle,
      category,
      html: buildHtml(),
      fields,
    });
    setBusy(false);
    if (ok) onOpenChange(false);
  };
  const stepLabels = ["Basics", "Sections", "Placeholders"] as const;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        className="max-h-[92vh] max-w-5xl gap-0 overflow-y-auto p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>New document template</DialogTitle>
          <DialogDescription>Build it from sections, then save.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-1.5">
                {n > 1 && (
                  <div
                    className={cn(
                      "h-0.5 w-6 rounded-full",
                      step > n - 1 ? "bg-primary" : "bg-border",
                    )}
                  />
                )}
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                    step >= n
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {step > n ? <Check className="h-3.5 w-3.5" /> : n}
                </div>
              </div>
            ))}
          </div>
          <div className="ml-2 flex gap-4 text-[11.5px] font-semibold text-faint">
            {stepLabels.map((l, i) => (
              <span key={l} className={step === i + 1 ? "text-foreground" : undefined}>
                {l}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 p-6">
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <label className="text-xs font-semibold text-foreground">Template name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Site Visit Report"
                    className="mt-1.5"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground">
                    Subtitle (optional)
                  </label>
                  <Input
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder="Prepared for the client after each visit"
                    className="mt-1.5 text-muted-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground">Trade</label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="mt-1.5 h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GENERAL_CATEGORY}>{GENERAL_CATEGORY}</SelectItem>
                      {CATEGORY_ORDER.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground">Cover page style</label>
                  <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                    {COVERS.map((c) => {
                      const active = cover === c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setCover(c.key)}
                          className={cn(
                            "rounded-[10px] border-[1.5px] p-3 text-left transition-colors",
                            active
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40",
                          )}
                        >
                          <div className="mb-2 h-11 overflow-hidden rounded-md bg-muted/70">
                            {c.key === "minimal" && (
                              <div className="flex h-full items-center px-3">
                                <div className="h-1.5 w-3/5 rounded bg-faint/70" />
                              </div>
                            )}
                            {c.key === "centered" && (
                              <div className="flex h-full flex-col items-center justify-center gap-1">
                                <div className="h-1.5 w-1/2 rounded bg-faint/70" />
                                <div className="h-1 w-1/3 rounded bg-faint/40" />
                              </div>
                            )}
                            {c.key === "hero" && (
                              <div className="flex h-full items-center bg-primary/15 px-3">
                                <div className="h-1.5 w-1/2 rounded bg-primary" />
                              </div>
                            )}
                            {c.key === "photo" && (
                              <div className="h-full bg-gradient-to-br from-neutral-600 to-neutral-800" />
                            )}
                          </div>
                          <div className="text-[12.5px] font-semibold">{c.label}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">{c.hint}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <p className="text-[12.5px] text-faint">
                  Drag to reorder. Click a token below to insert it into the body text.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {TOKENS.map((t) => (
                    <button
                      key={t.token}
                      type="button"
                      onClick={() => insertToken(t.token)}
                      title={t.label}
                      className="rounded-md bg-primary/10 px-2 py-1 font-mono text-[11px] font-bold text-primary transition-colors hover:bg-primary/15"
                    >
                      {"{{" + t.token + "}}"}
                    </button>
                  ))}
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={sections.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2.5">
                      {sections.map((s) => (
                        <SectionEditorRow
                          key={s.id}
                          section={s}
                          textareaRef={(el) => {
                            textareaRefs.current[s.id] = el;
                          }}
                          onFocus={() => setInsertTarget(s.id)}
                          onChange={(patch) => updateSection(s.id, patch)}
                          onRemove={() => setSections((xs) => xs.filter((x) => x.id !== s.id))}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <Button variant="outline" className="w-full" onClick={addSection}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add section
                </Button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Placeholders are tokens like{" "}
                  <span className="rounded bg-primary/10 px-1 py-0.5 font-mono text-[11px] font-bold text-primary">
                    {"{{project_name}}"}
                  </span>{" "}
                  that get replaced with real project data when the template is used.
                </p>
                <div className="flex flex-wrap gap-2">
                  {offeredPlaceholders.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 font-mono text-[11px] font-bold text-primary"
                    >
                      {"{{" + p + "}}"}
                      <button
                        type="button"
                        aria-label={"Remove " + p}
                        onClick={() => removeField(p)}
                        className="text-primary/60 transition-colors hover:text-primary"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newField}
                    onChange={(e) => setNewField(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addField();
                      }
                    }}
                    placeholder="e.g. client_name"
                    className="flex-1 font-mono text-[13px]"
                  />
                  <Button variant="outline" onClick={addField}>
                    + Add
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-7 flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3)}
                disabled={step === 1 || busy}
              >
                <ChevronLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              {step < 3 ? (
                <Button
                  onClick={() => setStep((s) => Math.min(3, s + 1) as 1 | 2 | 3)}
                  disabled={step === 1 && !name.trim()}
                >
                  Next <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
                  {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Save template
                </Button>
              )}
            </div>
          </div>
          {/* --------------------------------------------------- live preview */}
          <div className="hidden border-l border-border bg-muted/30 p-6 md:block">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
              Live preview
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_28px_-18px_rgba(16,25,41,0.5)]">
              {cover === "minimal" && (
                <div className="px-7 py-8">
                  <div className="text-[19px] font-bold">{name || "Untitled template"}</div>
                  {subtitle && <div className="mt-1 text-[12px] text-faint">{subtitle}</div>}
                </div>
              )}
              {cover === "centered" && (
                <div className="px-7 py-10 text-center">
                  <div className="text-[21px] font-bold">{name || "Untitled template"}</div>
                  {subtitle && <div className="mt-1 text-[12px] text-faint">{subtitle}</div>}
                </div>
              )}
              {cover === "hero" && (
                <div className="bg-primary px-7 py-7 text-primary-foreground">
                  <div className="text-[20px] font-bold">{name || "Untitled template"}</div>
                  {subtitle && <div className="mt-1 text-[12px] opacity-85">{subtitle}</div>}
                </div>
              )}
              {cover === "photo" && (
                <div className="bg-gradient-to-br from-neutral-700 to-neutral-900 px-7 py-9 text-center text-white">
                  <div className="text-[20px] font-bold">{name || "Untitled template"}</div>
                  {subtitle && <div className="mt-1 text-[12px] opacity-80">{subtitle}</div>}
                </div>
              )}
              <div className="space-y-4 px-7 py-6">
                {sections
                  .filter((s) => s.heading.trim() || s.body.trim())
                  .map((s) => (
                    <div key={s.id}>
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-faint">
                        {s.heading}
                      </div>
                      <div className="text-[12.5px] leading-relaxed text-muted-foreground">
                        {samplePreview(s.body)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-faint">
              This updates as you edit - what your client sees is exactly what you are building
              here.
            </p>
          </div>
        </div>
        <DialogFooter className="sr-only" />
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------- sortable section row */

function SectionEditorRow({
  section,
  textareaRef,
  onFocus,
  onChange,
  onRemove,
}: {
  section: Section;
  textareaRef: (el: HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onChange: (patch: Partial<Section>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border border-border bg-card px-3 py-3 transition-colors",
        isDragging && "relative z-[5] opacity-90 shadow-[0px_14px_28px_-18px_rgba(16,25,41,0.55)]",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
          className="mt-1 shrink-0 cursor-grab touch-none rounded text-muted-foreground/40 hover:text-muted-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={section.heading}
              onChange={(e) => onChange({ heading: e.target.value })}
              placeholder="Section heading"
              aria-label="Section heading"
              className="h-8 border-0 px-0 text-[13.5px] font-semibold shadow-none focus-visible:ring-0"
            />
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
              {SECTION_KIND_LABEL[section.kind]}
            </span>
          </div>
          <Textarea
            ref={(el) => {
              textareaRef(el);
            }}
            value={section.body}
            onChange={(e) => onChange({ body: e.target.value })}
            onFocus={onFocus}
            rows={2}
            aria-label="Section body"
            className="mt-0.5 resize-y text-[13px] leading-relaxed"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove section"
          className="mt-1 shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-destructive"
          title="Remove section"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
