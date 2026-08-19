/**
 * Assignment, said once.
 *
 * Checklists, tasks and workflows each grew their own idea of who a piece of
 * work belongs to and who may close it, which is how the same job could be
 * marked complete by the manager who handed it out on one screen and not on
 * another. The requirement is that the assignor/assignee relationship reads the
 * same everywhere it applies, so the rule is written here and imported, never
 * re-derived per feature.
 *
 * This module is the mirror of the triggers in
 * supabase/migrations/20260819000000_assignment_and_completion.sql -
 * `may_complete_assignment()` is the same four clauses in the same order. The
 * database is the enforcement (the web app writes to these tables directly, so
 * a check here is skippable); this exists so the button is disabled, and the
 * reason explained, before a write is refused. If one changes, change both.
 */

/** Roles the Settings page labels "Workspace admin" and "Project manager". */
const MANAGER_ROLES = new Set(["owner", "admin"]);

export function isManagerRole(role: string | null | undefined): boolean {
  return !!role && MANAGER_ROLES.has(role);
}

/* ------------------------------------------------------------------ status */

export type AssignmentStatus = "pending" | "in_progress" | "complete";

export const ASSIGNMENT_STATUS_META: Record<
  AssignmentStatus,
  { label: string; className: string; dot: string }
> = {
  pending: {
    label: "Pending",
    className: "border-border bg-muted/60 text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
  in_progress: {
    label: "In progress",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  complete: {
    label: "Complete",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
};

/**
 * Where a piece of work stands, from the two things every assignable record
 * has: whether it was closed, and how much of it has been answered.
 *
 * "In progress" keys off work done rather than off an assignee existing -
 * assigning a checklist to someone does not make it started, and the crew
 * member who has ticked four of nine boxes has plainly started whether or not
 * anyone assigned it to them.
 */
export function assignmentStatus(input: {
  completedAt: string | null | undefined;
  done?: number;
  total?: number;
}): AssignmentStatus {
  if (input.completedAt) return "complete";
  if ((input.done ?? 0) > 0) return "in_progress";
  return "pending";
}

/* ------------------------------------------------------------------ rights */

export interface AssignmentSubject {
  /** The user the work was handed to, or null if nobody holds it. */
  assignedTo: string | null;
  /** The user who handed it over, or null if it was never assigned. */
  assignedBy: string | null;
}

export interface AssignmentViewer {
  userId: string | null;
  /** From `useTeamMembers().isManager` - the caller's own team role. */
  isManager: boolean;
}

export interface CompletionRights {
  /** May this viewer close the work at all? */
  canComplete: boolean;
  /**
   * True when they can only do it because they are a manager - someone else is
   * assigned and it is not their own work. The action is allowed but it is
   * somebody else's name being overridden, so the UI confirms first.
   */
  isOverride: boolean;
  /** Why not, phrased for a tooltip. Null when `canComplete`. */
  reason: string | null;
}

/**
 * Who may mark this complete.
 *
 * Two questions, not one: *may* you close it, and is closing it your own work
 * or somebody else's?
 *
 * Free, with no ceremony:
 *   - nobody is assigned - unassigned work belongs to whoever picks it up
 *   - you are the assignee - you did it, and it timestamps to you
 *
 * Allowed, but as an override the UI confirms first:
 *   - you assigned it to someone else
 *   - you are a manager
 *
 * The assignor counting as an override is the point of the whole feature and
 * not an oversight. The complaint that started it was precisely a manager who
 * had assigned a checklist to a tech and could still close it himself with
 * nothing marking that as unusual - so "I delegated this" is exactly the case
 * that needs to be named out loud. They keep the ability, because a tech can be
 * unreachable and the record still has to close; what they lose is doing it
 * silently and having the record read as though the tech signed it off.
 *
 * The database allows all four (`may_complete_assignment`). This split is a UI
 * concern: permission and ceremony are different questions.
 */
export function completionRights(
  subject: AssignmentSubject,
  viewer: AssignmentViewer,
  assigneeName?: string | null,
): CompletionRights {
  const me = viewer.userId;
  if (!me) {
    return { canComplete: false, isOverride: false, reason: "You are not signed in." };
  }
  if (!subject.assignedTo) return { canComplete: true, isOverride: false, reason: null };
  if (subject.assignedTo === me) return { canComplete: true, isOverride: false, reason: null };

  const who = assigneeName?.trim() || "the assignee";
  if (subject.assignedBy === me || viewer.isManager) {
    return {
      canComplete: true,
      isOverride: true,
      reason: `Assigned to ${who} - completing it will record you as the one who closed it.`,
    };
  }
  return {
    canComplete: false,
    isOverride: false,
    reason: `Only ${who} can mark this complete. Ask a manager if it needs closing without them.`,
  };
}

/**
 * Reopening is deliberately looser than completing.
 *
 * The assignor being able to review and reopen is the point of the notification
 * they get, and a crew member who closed something by mistake should be able to
 * take it back without hunting down a manager. Nothing is destroyed by
 * reopening - a checklist's snapshot is rebuilt the next time it closes.
 */
export function canReopen(
  subject: AssignmentSubject & { createdBy?: string | null; completedBy?: string | null },
  viewer: AssignmentViewer,
): boolean {
  const me = viewer.userId;
  if (!me) return false;
  return (
    viewer.isManager ||
    subject.assignedBy === me ||
    subject.assignedTo === me ||
    subject.createdBy === me ||
    subject.completedBy === me
  );
}

/**
 * The patch that records an assignment.
 *
 * Always written as a pair. `assigned_by` exists so completion can report back
 * to a person rather than guessing at `created_by`, and it is only true of the
 * assignment it was written with - clearing the assignee clears both.
 */
export function assignmentPatch(
  assigneeId: string | null,
  actorId: string | null,
): { assigned_to: string | null; assigned_by: string | null } {
  return {
    assigned_to: assigneeId,
    assigned_by: assigneeId ? actorId : null,
  };
}

/* ---------------------------------------------------------------- ceremony */

export interface OverrideConfirmCopy {
  title: string;
  description: string;
  confirmText: string;
}

/**
 * The sentence shown before one person closes another person's work.
 *
 * `completionRights` decides *whether* the ceremony is owed; this decides what
 * it says. It lives here for the same reason the rule does: the complaint that
 * reopened this was that the warning appeared on the status button and not in
 * the edit dialog, so a manager could close a tech's task silently just by
 * taking the long way round. One helper means a new completion path either uses
 * the shared wording or is obviously missing it.
 *
 * `detail` is for what is true of one surface and not the others (a checklist
 * seals a snapshot, a photo task closes one picture out of twelve); the first
 * two sentences are identical everywhere.
 */
export function overrideConfirm(input: {
  /** The thing being closed, quoted back to the user. */
  what: string;
  /** Who it belongs to, already resolved to a name. */
  who: string;
  detail?: string | null;
  confirmText?: string;
}): OverrideConfirmCopy {
  const who = input.who.trim() || "the assignee";
  const detail = input.detail?.trim();
  return {
    title: `Complete this for ${who}?`,
    description:
      `“${input.what}” is assigned to ${who}. You can close it, but the record will show ` +
      `you closed it, not ${who}.` +
      (detail ? ` ${detail}` : ""),
    confirmText: input.confirmText ?? "Complete anyway",
  };
}
