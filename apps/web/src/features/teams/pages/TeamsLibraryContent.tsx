import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/everlumen/client";
import {
  getMyTeam,
  getTeamActivity,
  inviteMember,
  removeMember,
  resendInvite,
  revokeInvite,
  updateMemberRole,
} from "@/features/teams/api";
import { SubcontractorsPanel } from "@/features/teams/components/SubcontractorsPanel";
import { useProfile } from "@/hooks/use-profile";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { relativeTime } from "@everlumen/shared";
import {
  assignableRoles,
  can,
  canManageMember,
  normaliseRole,
  roleLabelForTier,
} from "@everlumen/shared/team-permissions";

/*
 * The Teams page, laid out exactly as the Main-html reference
 * (public/Main-html/TeamsContent.dc.html): a Crew / Subcontractors / Roles &
 * Permissions / Account tab strip with the reference's tables and rows.
 *
 * Unlike the reference (a static mockup), every value is the account's real
 * data - the roster from getMyTeam, per-member activity from getTeamActivity,
 * assigned-project counts from project_assignments, subcontractors from
 * listSubcontractors, and the account fields from the user's profile. Fields
 * the product does not store (trade, insurance expiry, licence, timezone) are
 * drawn as a dash rather than invented.
 */

type TeamTab = "crew" | "subs" | "permissions" | "account";
type BillingTier = "starter" | "pro" | "team";

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["#4a5568", "#2f6f4f", "#3a4152", "#7c4a3a", "#37476b", "#6b4a7c"];

function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mt-6 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-faint first:mt-0">
      {children}
    </div>
  );
}

function fieldBoxClass() {
  return "rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground mb-4";
}

/* Roles & Permissions - the reference's fixed matrix, unchanged. */
const PERMISSION_ROWS: Array<[string, string, string, string]> = [
  ["View projects", "\u2713", "\u2713", "Assigned only"],
  ["Edit project details", "\u2713", "\u2713", "\u2713"],
  ["Assign crew", "\u2713", "\u2713", "\u2014"],
  ["Delete workflows", "\u2713", "\u2713", "\u2014"],
  ["Manage blueprints & checklists", "\u2713", "\u2014", "\u2014"],
  ["Invite crew members", "\u2713", "\u2713", "\u2014"],
  ["Manage billing & account settings", "\u2713", "\u2014", "\u2014"],
];

function InviteDialog({
  open,
  onClose,
  plan,
  roleOptions,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  plan: BillingTier;
  roleOptions: string[];
  onSend: (email: string, role: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  // Standard, not the first option (Admin): most invites are field crew, and a
  // default that hands out billing and team control is the wrong mistake to make.
  const defaultRole = roleOptions.includes("standard")
    ? "standard"
    : (roleOptions[0] ?? "standard");
  const [role, setRole] = useState<string>(defaultRole);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setRole(defaultRole);
    }
  }, [open, defaultRole]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={busy ? undefined : onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-dialog-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
        className="relative w-full max-w-[420px] rounded-xl border border-border bg-card p-6 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.3)]"
      >
        <div id="invite-dialog-title" className="mb-1 text-[17px] font-bold text-foreground">
          Invite crew member
        </div>
        <p className="mb-4 text-[12.5px] text-muted-foreground">
          They&rsquo;ll join your workspace as soon as they accept the email invite.
        </p>
        <label htmlFor="invite-email" className="mb-2 block text-[11.5px] font-semibold text-faint">
          Email
        </label>
        <input
          id="invite-email"
          autoFocus
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          className="mb-4 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary"
        />
        <label htmlFor="invite-role" className="mb-2 block text-[11.5px] font-semibold text-faint">
          Role
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="mb-5 w-full cursor-pointer rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
        >
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {roleLabelForTier(r, plan)}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
          >
            Cancel
          </button>
          <button
            disabled={!email.trim() || busy}
            onClick={() => {
              setBusy(true);
              void onSend(email.trim(), role).finally(() => setBusy(false));
            }}
            className="cursor-pointer rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Sending\u2026" : "Send invitation"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Library page (the mockup's tabbed Teams screen), real data ---- */

export function TeamsLibraryContent() {
  const qc = useQueryClient();
  const { profile } = useProfile();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TeamTab>("crew");
  const [inviteOpen, setInviteOpen] = useState(false);

  // Per-member assigned-project counts (the roster's "Active projects").
  const [assignedCounts, setAssignedCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await supabase
        .from("project_assignments" as any)
        .select("user_id, project_id");
      if (!live) return;
      if (error) {
        setAssignedCounts(null); // not readable for this caller; render a dash
        return;
      }
      const counts: Record<string, number> = {};
      const seen = new Set<string>();
      for (const a of (data ?? []) as any[]) {
        if (!a.user_id) continue;
        const key = `${a.user_id}|${a.project_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts[a.user_id] = (counts[a.user_id] ?? 0) + 1;
      }
      setAssignedCounts(counts);
    })();
    return () => {
      live = false;
    };
  }, []);

  const { data: teamData } = useQuery({
    queryKey: ["my-team"],
    queryFn: () => getMyTeam() as any,
  });
  const { data: activity } = useQuery({
    queryKey: ["team-activity"],
    queryFn: () => getTeamActivity() as any,
  });

  const team = teamData?.team ?? null;
  const members: any[] = teamData?.members ?? [];
  const myRole: string = teamData?.myRole ?? "standard";
  const plan: BillingTier = (teamData?.plan as BillingTier) ?? "starter";
  const canManagePeople = can(myRole, "manage_users") || can(myRole, "manage_own_crew");
  const canManageSubs = can(myRole, "manage_users");

  const invites: any[] = teamData?.invites ?? [];

  const lastAtByUser = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of (activity?.members ?? []) as any[]) {
      map.set(m.userId, m.lastActivityAt ?? null);
    }
    return map;
  }, [activity]);

  // Only the roles this plan holds AND this person may hand out: a Manager
  // invites Standard and Restricted crew, never another Manager or an Admin.
  const roleOptions = useMemo(
    () =>
      assignableRoles(plan, { assignmentsEnforced: true }).filter((r) =>
        canManageMember(myRole, r),
      ),
    [plan, myRole],
  );

  const teamName = team?.name ?? "Your team";
  const crewCount = members.length;

  const subtitleByTab: Record<TeamTab, string> = {
    crew: `${teamName}'s crew \u00b7 ${crewCount} ${crewCount === 1 ? "person" : "people"}${
      invites.length ? ` \u00b7 ${invites.length} invited` : ""
    }`,
    subs: "Outside crews you share specific jobs with",
    permissions: "What each role can see and do",
    account: "Business and personal settings",
  };
  // The Subcontractors tab carries its own "Invite subcontractor" button.
  const canOpenAction = tab !== "subs" && canManagePeople;
  const origin = typeof window !== "undefined" ? window.location.origin : undefined;
  const refreshTeam = () => {
    qc.invalidateQueries({ queryKey: ["my-team"] });
    qc.invalidateQueries({ queryKey: ["team-activity"] });
  };

  const sendInvite = async (email: string, role: string) => {
    try {
      const res: any = await inviteMember({ data: { email, role, origin } } as any);
      if (res?.emailSent === false) {
        toast.warning(`Invite created for ${email}, but the email did not send`, {
          description: "Use Resend under Pending invites to try again.",
        });
      } else {
        toast.success(res?.resent ? `Invite re-sent to ${email}` : `Invite sent to ${email}`);
      }
      setInviteOpen(false);
      refreshTeam();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send the invite");
    }
  };

  const changeRole = async (m: any, role: string) => {
    setBusyId(m.id);
    try {
      await updateMemberRole({ data: { memberId: m.id, role } } as any);
      toast.success(`${displayName(m)} is now ${roleLabelForTier(role, plan)}`);
      refreshTeam();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the role");
    } finally {
      setBusyId(null);
    }
  };

  const removeFromTeam = async (m: any) => {
    const ok = await confirm({
      title: `Remove ${displayName(m)}?`,
      description:
        "They lose access to every project straight away. Their photos and reports stay on the jobs.",
      confirmText: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setBusyId(m.id);
    try {
      await removeMember({ data: { memberId: m.id } } as any);
      toast.success(`${displayName(m)} removed`);
      refreshTeam();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not remove them");
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (inv: any) => {
    setBusyId(inv.id);
    try {
      const res: any = await resendInvite({ data: { inviteId: inv.id, origin } } as any);
      if (res?.emailSent === false)
        toast.warning("The invite email did not send. Try again shortly.");
      else toast.success(`Invite re-sent to ${inv.email}`);
      refreshTeam();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not resend the invite");
    } finally {
      setBusyId(null);
    }
  };

  const cancelInvite = async (inv: any) => {
    const ok = await confirm({
      title: `Cancel the invite to ${inv.email}?`,
      description: "The link in their email stops working. You can invite them again later.",
      confirmText: "Cancel invite",
      cancelText: "Keep it",
      variant: "destructive",
    });
    if (!ok) return;
    setBusyId(inv.id);
    try {
      await revokeInvite({ data: { inviteId: inv.id } } as any);
      toast.success("Invite cancelled");
      refreshTeam();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not cancel the invite");
    } finally {
      setBusyId(null);
    }
  };

  const lastActive = (member: any): string => {
    const at = lastAtByUser.get(member.user_id);
    return at ? relativeTime(at) : "\u2014";
  };
  const activeProjects = (member: any): string =>
    assignedCounts ? String(assignedCounts[member.user_id] ?? 0) : "\u2014";
  const displayName = (m: any) => m.profile?.full_name ?? "Unnamed member";
  const displayEmail = (m: any) => m.profile?.email ?? "\u2014";

  const tabClass = (active: boolean) =>
    `cursor-pointer border-b-[2.5px] px-0.5 pb-2 pt-[11px] text-[13px] font-semibold transition-colors ${
      active ? "border-primary text-foreground" : "border-transparent text-faint"
    }`;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-10">
      {/* Header */}
      <div className="mb-[22px] flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-bold tracking-[-0.01em] text-foreground">Teams</div>
          <div className="mt-1 text-[13.5px] text-muted-foreground">{subtitleByTab[tab]}</div>
        </div>
        {canOpenAction && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[9px] bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlusIcon />
            Invite crew member
          </button>
        )}
      </div>

      {/* Tab strip */}
      <div className="mb-[22px] flex gap-[26px] border-b border-border">
        <button onClick={() => setTab("crew")} className={tabClass(tab === "crew")}>
          Crew
        </button>
        <button onClick={() => setTab("subs")} className={tabClass(tab === "subs")}>
          Subcontractors
        </button>
        <button onClick={() => setTab("permissions")} className={tabClass(tab === "permissions")}>
          Roles &amp; Permissions
        </button>
        <button onClick={() => setTab("account")} className={tabClass(tab === "account")}>
          Account
        </button>
      </div>

      {/* Crew */}
      {tab === "crew" && (
        <div className="flex flex-col gap-6">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[2.4fr_1.2fr_1fr_1fr_0.8fr] items-center gap-4 border-b border-border bg-muted px-[18px] py-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                  Name
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                  Role
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                  Assigned jobs
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                  Last active
                </span>
                <span className="sr-only">Actions</span>
              </div>
              {members.length === 0 && (
                <div className="px-[18px] py-8 text-center text-[13px] text-faint">
                  No crew members yet. Invite your first teammate above.
                </div>
              )}
              {members.map((m, index) => {
                const isMe = m.user_id === user?.id;
                // Same rule the server enforces, so no control is offered that
                // the RPC would refuse. The owner row is never editable.
                const editable = !isMe && canManageMember(myRole, m.role);
                const current = normaliseRole(m.role);
                const options = roleOptions.includes(current as any)
                  ? roleOptions
                  : [current, ...roleOptions];
                return (
                  <div
                    key={m.user_id}
                    className="grid grid-cols-[2.4fr_1.2fr_1fr_1fr_0.8fr] items-center gap-4 border-b border-border px-[18px] py-3 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                      >
                        {initials(displayName(m), displayEmail(m))}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-foreground">
                          {displayName(m)}
                          {isMe && <span className="ml-1.5 font-normal text-faint">(you)</span>}
                        </div>
                        <div className="truncate text-[11.5px] text-faint">{displayEmail(m)}</div>
                      </div>
                    </div>
                    <div className="text-[12.5px] text-muted-foreground">
                      {editable ? (
                        <select
                          aria-label={`Role for ${displayName(m)}`}
                          value={current}
                          disabled={busyId === m.id}
                          onChange={(e) => void changeRole(m, e.target.value)}
                          className="w-full cursor-pointer rounded-md border border-border bg-card px-2 py-1.5 text-[12.5px] text-foreground outline-none focus:border-primary disabled:opacity-60"
                        >
                          {options.map((r) => (
                            <option key={r} value={r} disabled={!roleOptions.includes(r as any)}>
                              {roleLabelForTier(r, plan)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        roleLabelForTier(m.role, plan)
                      )}
                    </div>
                    <div className="font-mono text-[12.5px] text-foreground">
                      {activeProjects(m)}
                    </div>
                    <div className="text-xs text-faint">{lastActive(m)}</div>
                    <div className="text-right">
                      {editable && (
                        <button
                          type="button"
                          disabled={busyId === m.id}
                          onClick={() => void removeFromTeam(m)}
                          className="cursor-pointer rounded-md px-2 py-1 text-[12px] font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {canManageSubs && invites.length > 0 && (
            <div>
              <SectionLabel>Pending invites</SectionLabel>
              <div className="mt-2.5 overflow-x-auto rounded-xl border border-border bg-card">
                <div className="min-w-[560px]">
                  {invites.map((inv) => {
                    const expired =
                      inv.expires_at && new Date(inv.expires_at).getTime() < Date.now();
                    return (
                      <div
                        key={inv.id}
                        className="grid grid-cols-[2.4fr_1.2fr_1.4fr_auto] items-center gap-4 border-b border-border px-[18px] py-3 last:border-b-0"
                      >
                        <div className="min-w-0 truncate text-[13.5px] font-semibold text-foreground">
                          {inv.email}
                        </div>
                        <div className="text-[12.5px] text-muted-foreground">
                          {roleLabelForTier(inv.role, plan)}
                        </div>
                        <div className="text-xs text-faint">
                          {expired
                            ? "Expired, resend to renew"
                            : `Invited ${relativeTime(inv.created_at)}`}
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === inv.id}
                            onClick={() => void resend(inv)}
                            className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:opacity-60"
                          >
                            Resend
                          </button>
                          <button
                            type="button"
                            disabled={busyId === inv.id}
                            onClick={() => void cancelInvite(inv)}
                            className="cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subcontractors - the working panel (invite, job sharing, revoke). */}
      {tab === "subs" &&
        (canManageSubs ? (
          <SubcontractorsPanel isTeamPlan={plan === "team"} />
        ) : (
          <div className="rounded-xl border border-border bg-card px-[18px] py-8 text-center text-[13px] text-faint">
            Only owners and admins manage subcontractors.
          </div>
        ))}

      {/* Roles & Permissions */}
      {tab === "permissions" && (
        <div>
          <p className="mb-3.5 max-w-[640px] text-[12.5px] text-muted-foreground">
            What each role can do. Standard crew only see projects they&rsquo;re assigned to; Owner
            and Manager see everything.
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-[2.2fr_1fr_1fr_1fr] items-center gap-4 border-b border-border bg-muted px-[18px] py-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                Capability
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                Owner
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                Manager
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                Standard
              </span>
            </div>
            {PERMISSION_ROWS.map(([capability, owner, manager, standard]) => (
              <div
                key={capability}
                className="grid grid-cols-[2.2fr_1fr_1fr_1fr] items-center border-b border-border px-[18px] py-3.5 text-[13px] last:border-b-0"
              >
                <span className="text-foreground">{capability}</span>
                <span className={owner === "\u2014" ? "text-faint" : "text-primary"}>{owner}</span>
                <span className={manager === "\u2014" ? "text-faint" : "text-foreground"}>
                  {manager}
                </span>
                <span
                  className={
                    standard === "Assigned only" || standard === "\u2014"
                      ? "text-faint"
                      : "text-foreground"
                  }
                >
                  {standard}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Account */}
      {tab === "account" && (
        <div className="grid max-w-[900px] grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <div className="mb-3.5 text-[13.5px] font-semibold text-foreground">
              Business profile
            </div>
            <div className="mb-1.5 text-[11.5px] text-faint">Business name</div>
            <div className={fieldBoxClass()}>{teamName}</div>
            <div className="mb-1.5 text-[11.5px] text-faint">License number</div>
            <div className={fieldBoxClass()}>{"\u2014"}</div>
            <div className="mb-1.5 text-[11.5px] text-faint">Service area</div>
            <div className={fieldBoxClass()}>{"\u2014"}</div>
            <div className="mb-1.5 text-[11.5px] text-faint">Timezone</div>
            <div className={fieldBoxClass()}>{"\u2014"}</div>
          </div>
          <div>
            <div className="mb-3.5 text-[13.5px] font-semibold text-foreground">Your profile</div>
            <div className="mb-1.5 text-[11.5px] text-faint">Name</div>
            <div className={fieldBoxClass()}>{profile?.full_name ?? "Unnamed"}</div>
            <div className="mb-1.5 text-[11.5px] text-faint">Email</div>
            <div className={fieldBoxClass()}>{profile?.email ?? "\u2014"}</div>
            <div className="mb-1.5 text-[11.5px] text-faint">Role</div>
            <div className={fieldBoxClass()}>{roleLabelForTier(myRole, plan)}</div>
            {/* This used to be a switch that saved nothing. Email preferences
                live in Settings, so point there instead. */}
            <Link
              to="/settings"
              className="mt-1 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted/40"
            >
              <span>Email and notification preferences</span>
              <span className="font-semibold text-primary">Open settings</span>
            </Link>
          </div>
        </div>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        plan={plan}
        roleOptions={roleOptions}
        onSend={sendInvite}
      />
    </div>
  );
}
