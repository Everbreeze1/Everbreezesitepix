import { useEffect, useState } from "react";
import { Check, Loader2, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ASSIGNMENT_STATUS_META, type AssignmentStatus } from "@/lib/assignment";
import { cn } from "@/lib/utils";

/**
 * Only the three fields a name needs. `TeamMemberLite` satisfies this, and so
 * do the trimmed-down rosters several panels already build for themselves —
 * the picker has no business requiring an avatar it does not render.
 */
export interface AssignableMember {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

/**
 * The two controls that make an assignment legible, shared by every record that
 * has one so checklists, tasks and workflows cannot describe the same state in
 * three different vocabularies.
 */

/* -------------------------------------------------------------------- pill */

export function AssignmentStatusPill({
  status,
  className,
}: {
  status: AssignmentStatus;
  className?: string;
}) {
  const meta = ASSIGNMENT_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold",
        meta.className,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

/* ----------------------------------------------------------------- picker */

export function assigneeLabel(members: AssignableMember[], id: string | null | undefined): string {
  if (!id) return "Unassigned";
  const m = members.find((x) => x.user_id === id);
  return m?.full_name || m?.email || "Unknown";
}

const UNASSIGNED = "__unassigned";

/**
 * Pick an assignee, then save it.
 *
 * This used to write on change. Reassigning is not a filter — it moves a job
 * onto someone else's plate and fires a notification at them — and doing that
 * on the way past an open dropdown gave no moment to change your mind and no
 * confirmation that anything had happened. So the choice is held locally and
 * the Save button appears only once the selection differs from what is stored,
 * which also makes it the honest answer to "did that stick?".
 *
 * `saving` is owned here rather than passed in: the button is the only thing
 * that shows it, and every caller would otherwise keep an identical flag.
 */
export function AssigneeField({
  value,
  members,
  onSave,
  disabled,
  className,
  triggerClassName,
  label = "Assignee",
}: {
  value: string | null;
  members: AssignableMember[];
  /** Resolve false to keep the pending selection so it can be retried. */
  onSave: (next: string | null) => Promise<boolean>;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(value);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  /*
   * `touched` is what separates a pending edit from a stale one, and it cannot
   * be inferred from `draft !== value` alone: realtime and other tabs write
   * this column, so after an external change those two differ on a field
   * nobody has touched. An untouched field follows the record; a selection the
   * user made and has not saved is theirs and survives the update.
   */
  const dirty = touched && draft !== value;

  useEffect(() => {
    if (dirty) return;
    setDraft(value);
  }, [value, dirty]);

  const commit = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    // On failure the draft stays put and Save stays up, so it can be retried
    // without picking the person again.
    if (ok) setTouched(false);
  };

  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <Select
        value={draft ?? UNASSIGNED}
        onValueChange={(v) => {
          setTouched(true);
          setDraft(v === UNASSIGNED ? null : v);
        }}
        disabled={disabled || saving}
      >
        <SelectTrigger className={cn("h-8 w-[170px] text-xs", triggerClassName)} aria-label={label}>
          <div className="flex items-center gap-1.5 truncate">
            <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{assigneeLabel(members, draft)}</span>
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED} className="text-sm">
            Unassigned
          </SelectItem>
          {members.map((m) => (
            <SelectItem key={m.user_id} value={m.user_id} className="text-sm">
              {m.full_name || m.email || m.user_id.slice(0, 8)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Occupies no space until there is something to save, so the row does
          not reflow the moment a dropdown is touched. */}
      {dirty && !disabled && (
        <Button
          size="sm"
          className="h-8 shrink-0 px-2.5"
          onClick={() => void commit()}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Check className="mr-1 h-3.5 w-3.5" />
              Save
            </>
          )}
        </Button>
      )}
    </div>
  );
}
