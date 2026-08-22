import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  addUserNote,
  listUserNotes,
  setAdminRole,
  setUserTeamRole,
  type AdminRole,
  type PlatformUserDetail,
} from "@/lib/admin.functions";
import { usePrompt } from "@/hooks/use-prompt";

const ROLE_COPY: Record<AdminRole, string> = {
  support: "Read accounts, resend email, suspend, triage feedback",
  billing: "Read accounts, change plans, comp teams, manage subscriptions",
  superadmin: "Everything, including granting admin and deleting accounts",
};

/**
 * Platform admin, with its role.
 *
 * The roles have existed in `platform_admins` and been enforced on every
 * mutating service since they were added, but nothing in the product could set
 * them - so in practice every admin was a superadmin and the capability system
 * was decorative. This is the control that makes it real.
 */
export function AdminRolePanel({
  user,
  onChanged,
}: {
  user: PlatformUserDetail;
  onChanged: () => void;
}) {
  const prompt = usePrompt();
  const [busy, setBusy] = useState(false);

  const apply = async (role: AdminRole | null) => {
    const label =
      role === null
        ? "Revoke platform admin"
        : user.adminRole
          ? `Change role to ${role}`
          : `Grant ${role} access`;
    const reason = await prompt({
      title: `${label}?`,
      description:
        role === null
          ? "They lose the admin console immediately."
          : `${ROLE_COPY[role]}. Takes effect on their next request.`,
      label: "Reason (recorded in the audit log)",
      confirmText: label,
    });
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    try {
      await setAdminRole({ data: { userId: user.id, role, reason: reason.trim() } });
      toast.success(role === null ? "Admin access revoked" : `Role set to ${role}`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the role");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="flex items-center gap-2 text-sm font-extrabold text-foreground">
        <ShieldCheck className="h-4 w-4" /> Platform access
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {user.adminRole
          ? `Currently ${user.adminRole}.`
          : "Not a platform admin. Granting access lets them read every customer's data."}
      </p>

      <div className="mt-4 space-y-2">
        {(["support", "billing", "superadmin"] as const).map((role) => (
          <button
            key={role}
            type="button"
            disabled={busy || user.adminRole === role}
            onClick={() => apply(role)}
            className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-default ${
              user.adminRole === role
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-accent"
            }`}
          >
            <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-primary p-0.5">
              {user.adminRole === role && (
                <span className="block h-full w-full rounded-full bg-primary" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold capitalize text-foreground">{role}</span>
              <span className="block text-xs text-muted-foreground">{ROLE_COPY[role]}</span>
            </span>
          </button>
        ))}
      </div>

      {user.adminRole && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={busy}
          onClick={() => apply(null)}
        >
          Revoke platform admin
        </Button>
      )}
    </div>
  );
}

/**
 * Internal notes on an account.
 *
 * The audit log records what happened; it cannot record what the customer said
 * or what was agreed. Without somewhere to write "called about the duplicate
 * charge, refunding manually", that context lives in one person's inbox and
 * leaves with them.
 */
export function UserNotesPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "user-notes", userId],
    queryFn: () => listUserNotes({ data: { userId } }),
  });

  const save = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await addUserNote({ data: { userId, body: body.trim() } });
      setBody("");
      void qc.invalidateQueries({ queryKey: ["admin", "user-notes", userId] });
      toast.success("Note added");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the note");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="flex items-center gap-2 text-sm font-extrabold text-foreground">
        <StickyNote className="h-4 w-4" /> Support notes
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Internal only. The customer never sees these.
      </p>

      {data?.unavailable ? (
        <p className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-600">
          {data.unavailable}
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder="What happened, what was agreed, what to watch for."
            />
            <Button size="sm" disabled={busy || !body.trim()} onClick={save}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Add note
            </Button>
          </div>

          {isPending ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (data?.notes.length ?? 0) === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No notes on this account yet.</p>
          ) : (
            <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto">
              {data!.notes.map((n) => (
                <div key={n.id} className="rounded-lg border border-border p-3">
                  <p className="whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {n.author.name ?? n.author.email ?? "unknown"} ·{" "}
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TEAM_ROLES = ["owner", "admin", "manager", "standard", "restricted", "member"] as const;

/**
 * Change a member's role inside their team.
 *
 * The product can already do this, but only for someone who is already an owner
 * of that team and can sign in. The support case is the opposite: the owner has
 * left or locked themselves out, and somebody has to be promoted before anyone
 * can do anything. That previously meant the SQL editor.
 */
export function TeamMembershipPanel({
  user,
  onChanged,
}: {
  user: PlatformUserDetail;
  onChanged: () => void;
}) {
  const prompt = usePrompt();
  const [busy, setBusy] = useState<string | null>(null);

  if (!user.teams.length) return null;

  const change = async (teamId: string, teamName: string, role: string) => {
    const reason = await prompt({
      title: `Set role to ${role} in ${teamName}?`,
      description:
        role === "owner"
          ? "Owners can manage billing and remove other members. Use this to recover a team whose owner has left."
          : "This changes what they can do inside that team, immediately.",
      label: "Reason (recorded in the audit log)",
      confirmText: "Change role",
    });
    if (!reason || reason.trim().length < 3) return;

    setBusy(teamId);
    try {
      await setUserTeamRole({ data: { userId: user.id, teamId, role, reason: reason.trim() } });
      toast.success(`Role set to ${role}`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the role");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">Team membership</p>
      <div className="mt-3 space-y-3">
        {user.teams.map((t) => (
          <div key={t.id} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground">{t.name}</p>
              <span className="text-xs text-muted-foreground">
                {t.plan} · {t.subscriptionStatus}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TEAM_ROLES.map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={t.role === r ? "secondary" : "ghost"}
                  className="capitalize"
                  disabled={busy === t.id || t.role === r}
                  onClick={() => change(t.id, t.name, r)}
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/*
        Moving someone between teams is deliberately absent. Membership carries
        their projects and assignments by inference, so a "move" is a migration
        rather than one update - doing it as a dropdown would quietly detach a
        person from their own work.
      */}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Moving an account to a different team is not available here: their projects are attributed
        by membership, so a move would detach them from their work.
      </p>
    </div>
  );
}

/** Their actual reports, which previously existed only as a number. */
export function UserFeedbackPanel({ user }: { user: PlatformUserDetail }) {
  if (!user.feedback?.length) return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">
        Feedback from this account{" "}
        <span className="font-normal text-muted-foreground">({user.totals.feedbackReports})</span>
      </p>
      <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto">
        {user.feedback.map((f) => (
          <div key={f.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                {f.kind}
              </span>
              <span className="text-[11px] text-muted-foreground">{f.status}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {new Date(f.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {f.description ?? <span className="italic text-muted-foreground">No message</span>}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
