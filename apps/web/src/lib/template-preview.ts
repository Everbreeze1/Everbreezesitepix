import type { TemplateFieldPreview } from "./project-pages.functions";

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * What the document will read like once it exists, for the preview pane in the
 * "Use in a project" step.
 *
 * Mirrors `resolvePageTokens` on the server: a field with a value prints the
 * value, and anything still empty prints as the labelled blank the document
 * will actually contain. Never `{{token}}` - the whole point of previewing here
 * is to show the finished document rather than the template it came from.
 *
 * The values come from the server (`previewDocumentTemplate`), so the labels
 * and the resolution rules are the same ones the create call will apply. Typed
 * values are escaped: they are inserted into HTML, and a client called
 * `Smith & Sons <Roofing>` would otherwise break the preview around it.
 */
export function fillTemplatePreview(
  html: string,
  fields: TemplateFieldPreview[],
  typed: Record<string, string>,
): string {
  const byToken = new Map(fields.map((f) => [f.token, f]));
  return html.replace(TOKEN_RE, (_match, raw: string) => {
    const token = raw.toLowerCase();
    const field = byToken.get(token);
    const value = typed[token]?.trim() || field?.value || "";
    if (value) return `<span class="tpl-filled">${escapeHtml(value)}</span>`;
    const label = field?.label ?? token.replace(/_+/g, " ");
    return `<span class="tpl-blank">${escapeHtml(label)}</span>`;
  });
}

/** The fields this project cannot fill in by itself, in template order. */
export function blankFields(fields: TemplateFieldPreview[]): TemplateFieldPreview[] {
  return fields.filter((f) => !f.value);
}

/** Drops the untouched entries, so an empty box stays a blank in the document. */
export function typedValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [token, value] of Object.entries(values)) {
    if (value.trim()) out[token] = value.trim();
  }
  return out;
}
