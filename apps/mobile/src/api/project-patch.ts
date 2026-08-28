/**
 * What a project edit writes, free of imports so it can be tested directly.
 *
 * Same convention as `task-status.ts`, `task-dates.ts` and `photo-patch.ts`.
 * These columns are read by the web project list, the map, every report header
 * and the public share pages, so the shapes are a contract rather than an
 * implementation detail.
 */

/** The three buckets `PROJECT_STATUSES` defines in `@everlumen/shared`. */
export type ProjectStatusValue = "active" | "on_hold" | "completed";

/** The columns the phone is allowed to change on an existing project. */
export type ProjectPatch = {
  name?: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  client_name?: string | null;
  status?: string;
  starred?: boolean;
  archived?: boolean;
  /** An ISO timestamp trashes; `null` restores. */
  deleted_at?: string | null;
};

/** The fields the edit sheet collects. */
export type ProjectDraft = {
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  client_name: string | null;
  status: ProjectStatusValue;
};

/**
 * Trim a draft into a patch.
 *
 * Empty strings become null rather than being written through. An address line
 * saved as `""` is not the same as an absent one: `formatAddress` joins the
 * truthy parts, so a stored empty string is invisible there but still counts as
 * "has an address" anywhere that checks the column directly.
 */
export function draftToPatch(draft: ProjectDraft): ProjectPatch {
  return {
    name: draft.name.trim(),
    street: blankToNull(draft.street),
    city: blankToNull(draft.city),
    state: blankToNull(draft.state),
    zip: blankToNull(draft.zip),
    client_name: blankToNull(draft.client_name),
    status: draft.status,
  };
}

function blankToNull(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Toggling a star. Web writes the boolean directly, so this does too. */
export function starPatch(starred: boolean): ProjectPatch {
  return { starred };
}

/**
 * Archiving.
 *
 * Distinct from trashing: an archived project is finished and filed, a trashed
 * one is on its way to being deleted. The web list filters them separately and
 * merging the two here would make a phone archive look like a deletion on every
 * other screen.
 */
export function archivePatch(archived: boolean): ProjectPatch {
  return { archived };
}

/** Soft delete, matching the `deleted_at` convention every read already excludes. */
export function trashProjectPatch(now: () => Date = () => new Date()): ProjectPatch {
  return { deleted_at: now().toISOString() };
}

/** Undo a trash. */
export function restoreProjectPatch(): ProjectPatch {
  return { deleted_at: null };
}

/**
 * Whether a draft can be saved.
 *
 * Only the name is required, and only because a project with no name is
 * unfindable in a list that is sorted and searched by it. Everything else is
 * genuinely optional: someone standing on a driveway needs somewhere to put
 * photos, not a complete address.
 */
export function isSaveableDraft(draft: ProjectDraft): boolean {
  return draft.name.trim().length > 0;
}
