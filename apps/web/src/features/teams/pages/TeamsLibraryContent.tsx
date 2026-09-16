import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/everlumen/client";
import { getMyTeam, getTeamActivity, inviteMember } from "@/features/teams/api";
import { listSubcontractors } from "@/lib/subcontractors.functions";
import { useProfile } from "@/hooks/use-profile";
import { relativeTime } from "@everlumen/shared";
import {
  assignableRoles,
  can,
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

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        active ? "bg-status-active-soft text-status-active" : "bg-muted text-faint"
      }`}
      style={{ width: "fit-content" }}
    >
      {label}
    </span>
  );
}

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
  const [role, setRole] = useState<string>(roleOptions[0] ?? "standard");
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={busy ? undefined : onClose} />
      <div className="relative w-full max-w-[420px] rounded-xl border border-border bg-card p-6 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.3)]">
        <div className="mb-1 text-[17px] font-bold text-foreground">Invite crew member</div>
        <p className="mb-4 text-[12.5px] text-muted-foreground">
          They&rsquo;ll join your workspace as soon as they accept the email invite.
        </p>
        <div className="mb-2 text-[11.5px] font-semibold text-faint">Email</div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          className="mb-4 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary"
        />
        <div className="mb-2 text-[11.5px] font-semibold text-faint">Role</div>
        <select
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
  const [tab, setTab] = useState<TeamTab>("crew");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(true);

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

  const { data: subsData } = useQuery({
    queryKey: ["subcontractors"],
    queryFn: () => listSubcontractors() as any,
    enabled: !!teamData && canManageSubs,
  });

  const lastAtByUser = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of (activity?.members ?? []) as any[]) {
      map.set(m.userId, m.lastActivityAt ?? null);
    }
    return map;
  }, [activity]);

  const roleOptions = useMemo(
    () => assignableRoles(plan, { assignmentsEnforced: true }),
    [plan],
  );

  const teamName = team?.name ?? "Your team";
  const crewCount = members.length;
  const subCount = (subsData?.subcontractors ?? []).length;

  const subtitleByTab: Record<TeamTab, string> = {
    crew: `${teamName}'s crew \u00b7 ${crewCount} ${crewCount === 1 ? "person" : "people"}`,
    subs: `${subCount} ${subCount === 1 ? "subcontractor" : "subcontractors"} on file`,
    permissions: "What each role can see and do",
    account: "Business and personal settings",
  };
  const btnByTab: Record<TeamTab, string> = {
    crew: "Invite crew member",
    subs: "Add subcontractor",
    permissions: "Invite crew member",
    account: "Invite crew member",
  };
  const canOpenAction = tab === "subs" ? canManageSubs : canManagePeople;

  const openAction = () => {
    if (tab === "subs") {
      toast.info("The subcontractor invite flow opens here");
      return;
    }
    setInviteOpen(true);
  };

  const sendInvite = async (email: string, role: string) => {
    try {
      await inviteMember({ data: { email, role } } as any);
      toast.success("Invite sent");
      setInviteOpen(false);
      qc.invalidateQueries({ queryKey: ["my-team"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send the invite");
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
          <div
            onClick={openAction}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[9px] bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlusIcon />
            {btnByTab[tab]}
          </div>
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
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-[2.4fr_1fr_1fr_1fr] items-center gap-4 border-b border-border bg-muted px-[18px] py-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Name</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Role</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Active projects</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Last active</span>
          </div>
          {members.length === 0 && (
            <div className="px-[18px] py-8 text-center text-[13px] text-faint">
              No crew members yet. Invite your first teammate above.
            </div>
          )}
          {members.map((m, index) => (
            <div
              key={m.user_id}
              className="grid grid-cols-[2.4fr_1fr_1fr_1fr] items-center gap-4 border-b border-border px-[18px] py-3 last:border-b-0"
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
                  </div>
                  <div className="truncate text-[11.5px] text-faint">{displayEmail(m)}</div>
                </div>
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                {roleLabelForTier(m.role, plan)}
              </div>
              <div className="font-mono text-[12.5px] text-foreground">{activeProjects(m)}</div>
              <div className="text-xs text-faint">{lastActive(m)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Subcontractors */}
      {tab === "subs" && (
        <div>
          <p className="mb-3.5 max-w-[640px] text-[12.5px] text-muted-foreground">
            Outside trades and one-off crews you bring onto a project {"\u2014"} kept separate
            from your own W-2 employees.
          </p>
          {!canManageSubs ? (
            <div className="rounded-xl border border-border bg-card px-[18px] py-8 text-center text-[13px] text-faint">
              Only owners and admins manage subcontractors.
            </div>
          ) : (
            <>
              <div className="mb-3.5 overflow-hidden rounded-xl border border-border bg-card">
                <div className="grid grid-cols-[2fr_1.2fr_1.3fr_1fr] items-center gap-4 border-b border-border bg-muted px-[18px] py-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                    Company
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                    Trade
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                    Insurance
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
                    Status
                  </span>
                </div>
                {subCount === 0 ? (
                  <div className="px-[18px] py-8 text-center text-[13px] text-faint">
                    No subcontractors yet. Add your first outside crew to share specific jobs.
                  </div>
                ) : (
                  (subsData?.subcontractors as any[]).map((s) => (
                    <div
                      key={s.id}
                      className="grid grid-cols-[2fr_1.2fr_1.3fr_1fr] items-center gap-4 border-b border-border px-[18px] py-3.5 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-foreground">
                          {s.company_name || s.email}
                        </div>
                        <div className="truncate text-[11.5px] text-faint">
                          {s.email}
                          {s.projects?.length
                            ? ` \u00b7 ${s.projects.length} ${
                                s.projects.length === 1 ? "project" : "projects"
                              }`
                            : ""}
                        </div>
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">{"\u2014"}</div>
                      <div className="text-xs text-muted-foreground">{"\u2014"}</div>
                      <StatusPill
                        label={s.accepted_at ? "Active" : "Inactive"}
                        active={!!s.accepted_at}
                      />
                    </div>
                  ))
                )}
              </div>
              <div
                onClick={() => toast.info("The subcontractor invite flow opens here")}
                className="cursor-pointer rounded-xl border-[1.5px] border-dashed border-border px-5 py-3.5 text-center text-[12.5px] text-faint transition-colors hover:border-primary/50"
              >
                + Add subcontractor
              </div>
            </>
          )}
        </div>
      )}

      {/* Roles & Permissions */}
      {tab === "permissions" && (
        <div>
          <p className="mb-3.5 max-w-[640px] text-[12.5px] text-muted-foreground">
            What each role can do. Standard crew only see projects they&rsquo;re assigned to;
            Owner and Manager see everything.
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
            <div className="mt-1 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
              <span className="text-[13px] text-muted-foreground">
                Email me when a report is ready to send
              </span>
              <button
                onClick={() => setNotifyEmail((v) => !v)}
                aria-pressed={notifyEmail}
                aria-label="Email me when a report is ready to send"
                className="h-[19px] w-[34px] shrink-0 cursor-pointer rounded-full transition-colors"
                style={{ background: notifyEmail ? "var(--primary)" : "var(--muted)" }}
              >
                <span
                  className="block h-[15px] w-[15px] rounded-full bg-white transition-transform"
                  style={{
                    transform: notifyEmail ? "translateX(17px)" : "translateX(2px)",
                  }}
                />
              </button>
            </div>
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
