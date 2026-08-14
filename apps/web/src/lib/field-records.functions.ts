import { rpcOp } from "./sitepix-api";

/**
 * The public-share read side of the two field records - checklists and
 * workflows. Mirrors `apps/api/src/domains/projects/field-records.ts`.
 *
 * Only the *read* is an RPC. Issuing and revoking a link is a one-column write
 * on a row the owner and their teammates already hold RLS on, so the app does
 * it through supabase directly, the same way every other write on these two
 * panels does. Adding a server round-trip for `revoked_at` would have been a
 * second code path to the same column.
 */

export interface FieldRecordItem {
  id: string;
  label: string;
  description: string | null;
  /** `item_type` for a checklist, `kind` for a workflow. */
  type: string;
  required: boolean;
  answered: boolean;
  /** The answer as printable text; null when the tick alone is the answer. */
  answer: string | null;
  notes: string | null;
  completedAt: string | null;
  photoUrls: string[];
}

export interface FieldRecordSection {
  id: string;
  /** null for a checklist - one implicit, unnamed section. */
  name: string | null;
  description: string | null;
  notes: string | null;
  /** Designed to be signed - drives whether the sheet prints a signature rule. */
  requiresSignoff: boolean;
  signoff: { name: string | null; at: string } | null;
  items: FieldRecordItem[];
}

export interface FieldRecordCompany {
  name: string | null;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
}

export interface FieldRecordProject {
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface FieldRecordBody {
  kind: "checklist" | "workflow";
  title: string;
  description: string | null;
  createdAt: string;
  completedAt: string | null;
  notesHtml: string | null;
  sections: FieldRecordSection[];
  done: number;
  total: number;
}

export interface PublicFieldRecord {
  status: "ok" | "not_found" | "revoked";
  record: FieldRecordBody | null;
  project: FieldRecordProject | null;
  company: FieldRecordCompany | null;
  author: { name: string | null } | null;
}

/**
 * The migration that adds `share_token`, `revoked_at` and `notes_html` to both
 * record tables.
 *
 * Named here rather than typed into each screen so the "database is one
 * migration behind" state cannot go stale in one place and not the other - and
 * so grepping this constant finds every surface that depends on it.
 */
export const RECORD_MIGRATION = "20260816000000_checklist_workflow_documents.sql";

export const getPublicChecklist = rpcOp<{ token: string }, PublicFieldRecord>("getPublicChecklist");

export const getPublicWorkflow = rpcOp<{ token: string }, PublicFieldRecord>("getPublicWorkflow");
