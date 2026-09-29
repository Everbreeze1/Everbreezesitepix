import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { currentUserId } from "./blueprint-admin";
import {
  extractFields,
  newTemplateHtml,
  normaliseFiling,
  withBody,
  type DocTemplateRow,
  type FilingBucket,
} from "./document-template-view";

/**
 * Managing document templates: the same `document_templates` reads and writes
 * as the web's `DocumentTemplatesManager`, plus the `getDocumentTemplate` op
 * for opening one.
 *
 * Opening goes through the op rather than the row on purpose: template bodies
 * are authored HTML shared across the team, and the op runs the server's
 * sanitiser on read. The web learned that the hard way; the phone does not
 * render the raw column either.
 */

const db = (table: string): any => supabase.from(table as never);

/**
 * The library, without the bodies' HTML: `body->>key` pulls the few short
 * keys the list needs. Scoped to the team plus the shared built-ins, the web's
 * `team_id.eq.X,team_id.is.null`.
 */
export async function listDocTemplates(teamId: string | null): Promise<DocTemplateRow[]> {
  let query = db("document_templates")
    .select(
      "id, team_id, name, fields, archived, created_at, updated_at, description:body->>description, category:body->>category, filesUnder:body->>filesUnder, copiedFrom:body->>copiedFrom",
    )
    .order("updated_at", { ascending: false });
  if (teamId) query = query.or(`team_id.eq.${teamId},team_id.is.null`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({
    id: String(r.id),
    teamId: (r.team_id as string | null) ?? null,
    name: String(r.name ?? "Untitled document"),
    description: (r.description as string | null) || null,
    category: (r.category as string | null) || null,
    filesUnder: normaliseFiling(r.filesUnder),
    copiedFrom: (r.copiedFrom as string | null) || null,
    fields: Array.isArray(r.fields) ? (r.fields as string[]) : [],
    archived: Boolean(r.archived),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  }));
}

/** The body HTML, sanitised by the server. Never falls back to the raw column. */
export async function openDocTemplate(id: string): Promise<{ name: string; html: string }> {
  const result = await api.rpc<{ name?: string; html?: string }>("getDocumentTemplate", {
    templateId: id,
  });
  return { name: result?.name ?? "", html: result?.html ?? "" };
}

/** The stored body, read only so a write can keep keys this screen does not know. */
async function storedBody(id: string): Promise<unknown> {
  const { data, error } = await db("document_templates").select("body").eq("id", id).single();
  if (error) throw new Error(error.message);
  return (data as { body?: unknown } | null)?.body ?? null;
}

export async function createDocTemplate(args: {
  name: string;
  description: string;
  category: string | null;
  teamId: string | null;
}): Promise<string> {
  const userId = await currentUserId();
  const html = newTemplateHtml(args.name, args.description);
  const body: Record<string, unknown> = {
    style: "report",
    html,
    description: args.description.trim(),
  };
  if (args.category) body.category = args.category;
  const { data, error } = await db("document_templates")
    .insert({
      name: args.name.trim(),
      team_id: args.teamId,
      created_by: userId,
      body,
      fields: extractFields(html),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create that template");
  return String(data.id);
}

/** Save the editor: name, body HTML and the fields it now uses. */
export async function saveDocTemplate(id: string, name: string, html: string): Promise<void> {
  const body = withBody(await storedBody(id), { html });
  const { error } = await db("document_templates")
    .update({ name: name.trim() || "Untitled document", body, fields: extractFields(html) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Copy a template into the team. A copy of a built-in records `copiedFrom`
 * so the built-in steps aside behind it; a copy of the team's own is simply
 * a second template.
 */
export async function copyDocTemplate(args: {
  source: DocTemplateRow;
  name: string;
  teamId: string | null;
}): Promise<string> {
  const userId = await currentUserId();
  const { data: row, error: readError } = await db("document_templates")
    .select("body, fields")
    .eq("id", args.source.id)
    .single();
  if (readError || !row) throw new Error(readError?.message ?? "Could not read that template");
  const body =
    args.source.teamId === null ? withBody(row.body, { copiedFrom: args.source.id }) : row.body;
  const { data, error } = await db("document_templates")
    .insert({
      name: args.name,
      // Never inherit a built-in's null team: the copy must be the team's.
      team_id: args.teamId,
      created_by: userId,
      body,
      fields: row.fields ?? [],
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not copy that template");
  return String(data.id);
}

export async function setDocTemplateFiling(
  id: string,
  patch: { category?: string | null; filesUnder?: FilingBucket },
): Promise<void> {
  const body = withBody(await storedBody(id), patch);
  const { error } = await db("document_templates").update({ body }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setDocTemplateArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await db("document_templates").update({ archived }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteDocTemplate(id: string): Promise<void> {
  const { error } = await db("document_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
