import { parsePage } from "./doc-blocks";
import type { DocumentTemplate, TemplateField } from "./pages";

/**
 * The decisions behind starting a document from a template, kept out of the
 * screen so they can be tested without a device.
 *
 * The one that matters is honesty about what you are about to get. A document
 * built from a seeded template is rich HTML - tables, styled headings, images -
 * and the phone's editor refuses to rebuild that, so the page is READ-ONLY here
 * the moment it exists.
 *
 * That was the argument for not offering this on the phone at all, and it was
 * the wrong conclusion. A read-only page can still be appended to, shared and
 * exported as a PDF, which is the whole of what a handover certificate is for
 * on site. What was actually wrong was finding out afterwards. So the choice is
 * offered, and the consequence is stated BEFORE the document is created,
 * measured with the same parser the editor uses rather than guessed at.
 */

/** Templates in the order somebody scans them: their own first, then built-ins. */
export function groupTemplates(
  templates: DocumentTemplate[],
): { category: string; templates: DocumentTemplate[] }[] {
  const groups = new Map<string, DocumentTemplate[]>();
  for (const t of templates) {
    /*
     * A team's own saved templates carry no category. They go under "Your
     * team's" rather than into an "Other" bucket, because on a phone the list
     * has to answer "which of these did we write" without opening any of them.
     */
    const key = t.isExample ? t.category?.trim() || "Built-in" : "Your team's";
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const ordered = [...groups.entries()].map(([category, list]) => ({
    category,
    templates: [...list].sort((a, b) => a.name.localeCompare(b.name)),
  }));

  // The team's own first: they are the ones somebody is looking for by name.
  return ordered.sort((a, b) => {
    if (a.category === "Your team's") return -1;
    if (b.category === "Your team's") return 1;
    return a.category.localeCompare(b.category);
  });
}

export type Editability = { editable: true } | { editable: false; because: string };

/**
 * Whether the document this template produces can be edited on the phone.
 *
 * Runs the editor's own `parsePage` over the previewed body, so the answer is
 * the answer, not a guess about what "rich" means. Anything the parser refuses
 * is read-only, and the refusal text is what the page itself will say.
 */
export function templateEditability(html: string): Editability {
  const parsed = parsePage(html ?? "");
  if (!parsed.refusal) return { editable: true };
  return {
    editable: false,
    because:
      "The body will be read-only on the phone: it uses formatting the phone editor cannot rebuild. You can still add to the end of it, share it, and export it as a PDF.",
  };
}

/**
 * The tokens somebody still has to answer.
 *
 * A field the project already resolves is not a question - showing it as an
 * empty box invites somebody to retype the site address that was already right.
 */
export function unresolvedFields(fields: TemplateField[]): TemplateField[] {
  return fields.filter((f) => !(f.value ?? "").trim());
}

/**
 * Whether the create button can be pressed yet, and why not.
 *
 * The name is the only requirement. Unanswered merge tokens are deliberately
 * allowed through: the web app leaves them as the literal placeholder rather
 * than refusing, and a technician who does not know the client's reference
 * number should still be able to file the certificate and have somebody fill it
 * in later. Blocking here would make the phone stricter than the desk for a
 * reason nobody could see.
 */
export function createBlocker(title: string): string | null {
  return title.trim() ? null : "Give this document a name.";
}

/** What to say about the fields, in one line, before anything is typed. */
export function fieldSummary(fields: TemplateField[]): string {
  if (fields.length === 0) return "This template has nothing to fill in.";
  const open = unresolvedFields(fields).length;
  const filled = fields.length - open;
  if (open === 0) return `All ${fields.length} filled in from this job.`;
  if (filled === 0) return `${open} to fill in.`;
  return `${filled} filled in from this job, ${open} to type.`;
}
