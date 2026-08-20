import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, FileSignature, Loader2, Sparkles, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPageFromTemplate,
  previewDocumentTemplate,
  type TemplateFieldPreview,
} from "@/lib/project-pages.functions";
import { blankFields, fillTemplatePreview, typedValues } from "@/lib/template-preview";
import { useConfirm } from "@/hooks/use-confirm";

/**
 * The step between picking a template and having a document.
 *
 * "Use in a project" used to create the page on the click and drop the user
 * into the rich text editor to clean up whatever came out - which meant reading
 * a half-merged document and hand-editing merge syntax, in the heaviest surface
 * the app has. Everything that needed a human is asked for here instead, as
 * four or five plain text boxes, against a preview of the finished document.
 *
 * The fields and their resolved values come from the server, so what the
 * preview shows and what `createPageFromTemplate` writes cannot drift apart.
 */
export function UseTemplateDialog({
  templateId,
  project,
  folderId,
  onOpenChange,
  onCreated,
}: {
  /** Non-null opens the dialog. */
  templateId: string | null;
  /** `name` only fills in a sentence, so callers already inside a project skip it. */
  project: { id: string; name: string | null } | null;
  folderId?: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectId: string, pageId: string) => void;
}) {
  const open = Boolean(templateId && project);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<{ name: string; html: string } | null>(null);
  const [fields, setFields] = useState<TemplateFieldPreview[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  /**
   * What the document will be filed as. Prefilled with the project's name and
   * the template's, which is the whole point of asking here: the title used to
   * be the template's name alone, so a project's Documents tab listed
   * "HVAC Service Call Report" with nothing to say which visit it was, and the
   * crew retyped it by hand on every one.
   */
  const [title, setTitle] = useState("");
  /**
   * The title the server proposed, kept so a renamed document can be told from
   * an untouched one. Without it, closing always either asks or never asks.
   */
  const [suggestedTitle, setSuggestedTitle] = useState("");

  const projectId = project?.id ?? null;
  const confirm = useConfirm();

  useEffect(() => {
    if (!templateId || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setTemplate(null);
    setFields([]);
    setValues({});
    setTitle("");
    setSuggestedTitle("");
    (async () => {
      try {
        const res = await previewDocumentTemplate({ data: { templateId, projectId } });
        if (cancelled) return;
        setTemplate({ name: res.name, html: res.html });
        setFields(res.fields);
        setTitle(res.suggestedTitle);
        setSuggestedTitle(res.suggestedTitle);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Could not open this template");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, projectId]);

  /**
   * Has anything been typed that closing would throw away?
   *
   * Every box on the left is unsaved until "Create document" is pressed, and
   * this dialog used to dismiss on a click anywhere outside it - which on a
   * wide screen is most of the window, since the panel of boxes is a 320px
   * column. The client found it the way anyone would: "i just opened one to
   * fill it out, when i clicked out of it accidentally the whole thing
   * disappeared. I was filling out the header field etc."
   *
   * Reopening does not bring it back either - the effect above resets every
   * piece of state on `templateId`, so the work is genuinely gone.
   */
  const dirty =
    title.trim() !== suggestedTitle.trim() || Object.values(values).some((v) => v.trim() !== "");

  /**
   * Leave, asking first if there is anything to lose. The X, Cancel and Escape
   * all come through here; a click outside does not reach it at all.
   */
  async function requestClose() {
    if (creating) return;
    if (
      dirty &&
      !(await confirm({
        title: "Discard what you have filled in?",
        description:
          "This document has not been created yet, so the name and the fields you typed are not saved anywhere.",
        confirmText: "Discard",
        cancelText: "Keep filling it in",
        variant: "destructive",
      }))
    )
      return;
    onOpenChange(false);
  }

  const blanks = useMemo(() => blankFields(fields), [fields]);
  const filled = useMemo(() => fields.filter((f) => f.value), [fields]);
  const previewHtml = useMemo(
    () => (template ? fillTemplatePreview(template.html, fields, values) : ""),
    [template, fields, values],
  );

  async function create() {
    if (!templateId || !projectId) return;
    setCreating(true);
    try {
      const res = await createPageFromTemplate({
        data: {
          projectId,
          templateId,
          folderId: folderId ?? null,
          // Cleared to nothing, so let the server name it rather than failing
          // the schema's `min(1)` on an empty string.
          title: title.trim() || undefined,
          values: typedValues(values),
        },
      });
      onCreated(projectId, res.page.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the document");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Only ever asked to close: nothing here opens itself.
        if (!v) void requestClose();
      }}
    >
      <DialogContent
        /* A stray click past the edge of the dialog is not "throw this away".
           Closing is the X, Cancel, or Escape, and each of those asks when
           there is something typed. */
        onInteractOutside={(e) => e.preventDefault()}
        className="flex h-[88vh] max-w-5xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-6 pb-4 pt-5 text-left">
          <DialogTitle className="truncate">{template?.name ?? "New document"}</DialogTitle>
          <DialogDescription>
            {project?.name
              ? `Filed under Documents in ${project.name}.`
              : "Filed under this project's Documents."}{" "}
            Anything you leave empty becomes a blank you can click and type into later.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="shrink-0 space-y-5 overflow-y-auto border-b p-5 md:w-80 md:border-b-0 md:border-r">
              {/* First, above the merge fields: it is the one thing on this
                  screen that decides how the document is found again. */}
              <label className="block space-y-1">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <FileSignature className="h-3.5 w-3.5" /> Document name
                </span>
                <Input
                  className="h-9 font-semibold"
                  value={title}
                  placeholder={template?.name ?? "New document"}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <span className="block text-[11px] text-muted-foreground">
                  Named after this project so it is not filed under the template&rsquo;s name.
                  Change it here or later.
                </span>
              </label>

              {blanks.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Wand2 className="h-3.5 w-3.5" /> Fill in
                  </div>
                  {blanks.map((f) => (
                    <label key={f.token} className="block space-y-1">
                      <span className="text-xs font-semibold text-foreground">{f.label}</span>
                      <Input
                        className="h-9"
                        value={values[f.token] ?? ""}
                        placeholder={placeholderFor(f)}
                        onChange={(e) => setValues((v) => ({ ...v, [f.token]: e.target.value }))}
                      />
                      {/* Where to put it so it is never asked for again. An
                          empty field here means its home is empty too, and the
                          user has no way of knowing that home exists. */}
                      {f.source === "settings" && (
                        <span className="block text-[11px] text-muted-foreground">
                          Set this once under Settings and every document picks it up.
                        </span>
                      )}
                      {f.source === "auto" && (
                        <span className="block text-[11px] text-muted-foreground">
                          Save it on the project and it fills in by itself next time.
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing left to fill in. This document is ready as it is.
                </p>
              )}

              {filled.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" /> Filled in for you
                  </div>
                  <dl className="space-y-1.5 rounded-lg border border-border/60 bg-muted/40 p-3">
                    {filled.map((f) => (
                      <div key={f.token} className="flex items-baseline justify-between gap-3">
                        <dt className="shrink-0 text-[11px] font-medium text-muted-foreground">
                          {f.label}
                        </dt>
                        <dd className="truncate text-xs font-semibold text-foreground">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-6">
              <div className="mx-auto max-w-[720px] rounded-sm border border-border bg-card p-10 shadow-sm">
                {/* The title box above, not the template's name: the preview is
                    the document being created, and the heading is the first
                    place its name is worth seeing. */}
                <h2 className="mb-4 text-2xl font-extrabold text-foreground">
                  {title.trim() || template?.name}
                </h2>
                <div
                  className="tiptap prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t px-6 py-3">
          <Button variant="outline" onClick={() => void requestClose()} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={create} disabled={creating || loading}>
            {creating ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="mr-1.5 h-4 w-4" />
            )}
            Create document
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A worked example beats restating the label the user is already looking at. */
const EXAMPLES: Record<string, string> = {
  weather: "Clear, 72F",
  client_name: "Sarah Whitfield",
  client_contact: "sarah@example.com",
  project_number: "PRJ-00421",
  // Both spellings of the author's job title: templates written since the
  // Fields panel started inserting `{{job_title}}` use the new one, and the
  // seeded library still carries the old.
  job_title: "Project Manager",
  prepared_by_title: "Project Manager",
};

function placeholderFor(field: TemplateFieldPreview): string {
  return EXAMPLES[field.token] ?? field.label;
}
