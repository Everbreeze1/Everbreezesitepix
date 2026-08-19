import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Trash2,
  Copy,
  Crown,
  Shield,
  User as UserIcon,
  Send,
  LogOut,
  Sparkles,
  Lock,
  Search,
  RefreshCcw,
  UserPlus,
  X,
  Check,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getMyTeam,
  createTeam,
  inviteMember,
  revokeInvite,
  removeMember,
  updateMemberRole,
  leaveTeam,
  resendInvite,
  resendMemberConfirmation,
} from "@/features/teams/api";
import { relativeTime } from "@sitepix/shared";
import {
  ROLE_LABEL,
  assignableRoles,
  can,
  canManageMember,
  normaliseRole,
  roleDescriptionForTier,
  roleLabelForTier,
  tierHasJobScoping,
  type AssignableRole,
  type TeamRole,
} from "@sitepix/shared/team-permissions";
import { SubcontractorsPanel } from "../components/SubcontractorsPanel";
import { AssignJobsDialog } from "../components/AssignJobsDialog";
import { RoleBadge } from "../components/RoleBadge";

const AVATAR_PALETTE = ["#059669", "#7C3AED", "#D97706", "#DB2777", "#0EA5E9", "#65A30D"];
const avatarColor = (role: string, index: number) =>
  role === "owner" ? "#101929" : AVATAR_PALETTE[index % AVATAR_PALETTE.length];

type TeamPlan = "starter" | "pro" | "team";
const PLAN_LABEL: Record<TeamPlan, string> = { starter: "Starter", pro: "Pro", team: "Team" };

const roleIcon = (r: string) =>
  r === "owner" ? (
    <Crown className="h-3 w-3" />
  ) : r === "admin" ? (
    <Shield className="h-3 w-3" />
  ) : (
    <UserIcon className="h-3 w-3" />
  );

/*
 * Both go through `normaliseRole` so the historical `member` value and the
 * spec's `standard` render as one thing. Falling back to the raw value would
 * print "restricted" in lower case next to properly cased labels.
 *
 * Both take the plan, because the tiers name the base seat differently on
 * purpose: Team runs a hierarchy and calls it Standard, Pro is flat and calls
 * it Member. The rule lives in `team-permissions.ts` so no screen re-derives it.
 */
const roleLabel = (role: string, plan: TeamPlan) => roleLabelForTier(role, plan);
const roleTitle = (role: string, plan: TeamPlan) => roleDescriptionForTier(role, plan);

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function TeamsPage() {
  const fetchTeam = getMyTeam;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["my-team"] });

  if (isLoading) {
    return null;
  }

  if (!data?.team) {
    return <TeamDesignPreview />;
  }

  /*
   * Who reaches this page: anyone the matrix lets manage people.
   *
   * It was owner-only, which contradicted section 4 - an Admin has
   * `manage_users` and a Manager has `manage_own_crew`, and neither could open
   * the only screen where those capabilities exist.
   *
   * Opening it is safe in a way that is easy to assume it is not. This page
   * carries NO billing controls - see the note in the header below; the Stripe
   * portal has one home, Settings → Billing, and that is gated separately on
   * `can(role, "billing")`. What an Admin or Manager gains here is the roster,
   * invites and the seat count, which is exactly the job they were given.
   */
  const mayManagePeople = can(data.myRole, "manage_users") || can(data.myRole, "manage_own_crew");
  if (!mayManagePeople) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-16 text-center">
        <h1 className="font-display text-2xl font-bold text-foreground">
          You don't manage this team
        </h1>
        <p className="mt-2 font-manrope text-sm text-muted-foreground">
          You're on <strong className="text-foreground">{data.team.name}</strong> as{" "}
          {ROLE_LABEL[normaliseRole(data.myRole)]}. Managing members, invites and seats is for
          Owners, Admins and Managers.
        </p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex items-center rounded-lg bg-primary px-4 py-2 font-manrope text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <TeamDashboard
      team={data.team}
      members={data.members}
      invites={data.invites}
      myRole={data.myRole ?? "member"}
      plan={(data.plan as TeamPlan) ?? "starter"}
      memberLimit={data.memberLimit ?? 2}
      onChange={invalidate}
    />
  );
}

// ----------------------------------------------------------------
// Static design preview matching the Figma "Teams" mock - shown whenever
// the signed-in account has no team yet, so the sidebar's Teams link
// always lands on the finished layout instead of the onboarding form.
const DESIGN_PREVIEW_MEMBERS = [
  { id: "preview-1", role: "owner", name: "Jordan Mitchell", active: "now" },
  { id: "preview-2", role: "admin", name: "Avery Stone", active: "2h ago" },
  { id: "preview-3", role: "member", name: "Lena Rivera", active: "3h ago" },
  { id: "preview-4", role: "member", name: "Trey Sullivan", active: "4h ago" },
];

function TeamDesignPreview() {
  return (
    <div className="mx-auto max-w-[1192px] px-6 pb-24 pt-10 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
            Stay aligned
          </p>
          <h1 className="font-display mt-3 text-[32px] font-bold leading-9 tracking-[-1.1px] text-foreground sm:text-[38.4px] sm:tracking-[-1.344px]">
            Teams
          </h1>
          <p className="mt-3 max-w-md font-manrope text-sm text-muted-foreground">
            Manage the people who capture, review, and share your project record.
          </p>
        </div>
        <Button className="h-10 rounded-lg bg-primary px-5 font-manrope text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90">
          <UserPlus className="mr-2 h-4 w-4" />
          Invite teammate
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col rounded-3xl border border-border bg-card/[0.82] shadow-[0_20px_50px_-36px_rgba(16,25,41,0.5)]">
          <ul className="divide-y divide-border">
            {DESIGN_PREVIEW_MEMBERS.map((m, idx) => (
              <li key={m.id} className="flex items-center justify-between gap-4 p-5">
                <div className="flex min-w-0 items-center gap-4">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-manrope text-xs font-extrabold text-white"
                    style={{ background: avatarColor(m.role, idx) }}
                  >
                    {initials(m.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-manrope text-sm font-extrabold text-foreground">
                      {m.name}
                    </div>
                    <div className="mt-0.5 truncate font-manrope text-xs text-muted-foreground">
                      {roleTitle(m.role, "team")} · Active {m.active}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-xl bg-muted px-3 py-2 font-manrope text-xs font-extrabold text-muted-foreground transition hover:bg-accent"
                >
                  Manage
                </button>
              </li>
            ))}
          </ul>
        </div>

        <WorkspaceCoverageCard
          seatsUsed={DESIGN_PREVIEW_MEMBERS.length}
          memberLimit={10}
          plan="team"
          canInvite
          onInviteClick={() => {}}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
function CreateTeamView({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const create = createTeam;
  const m = useMutation({
    mutationFn: () => create({ data: { name: name.trim() } }),
    onSuccess: () => {
      toast.success("Team created");
      onCreated();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create team"),
  });

  return (
    <div className="mx-auto max-w-[1192px] px-6 pb-24 pt-10 md:px-10">
      <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
        Stay aligned
      </p>
      <h1 className="font-display mt-3 text-[32px] font-bold leading-9 tracking-[-1.1px] text-foreground sm:text-[38.4px] sm:tracking-[-1.344px]">
        Teams
      </h1>
      <p className="mt-3 max-w-md font-manrope text-sm text-muted-foreground">
        Create a team to invite teammates and share projects, photos, and reports.
      </p>

      <div className="mt-8 rounded-3xl bg-sidebar p-6 text-sidebar-foreground md:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sidebar-ring/10 text-sidebar-ring">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-manrope text-lg font-extrabold text-sidebar-foreground">
              Start your team
            </h2>
            <p className="font-manrope text-sm text-sidebar-foreground/60">
              You'll be the account owner. Invite teammates by email after.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="Team name (e.g. Acme Construction)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="border-sidebar-border bg-sidebar-foreground/5 text-sidebar-foreground placeholder:text-sidebar-foreground/40 sm:flex-1"
          />
          <Button
            disabled={!name.trim() || m.isPending}
            onClick={() => m.mutate()}
            className="bg-sidebar-ring font-manrope font-bold text-sidebar-foreground hover:bg-sidebar-ring/90"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {m.isPending ? "Creating…" : "Create team"}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {[
          {
            t: "Shared projects",
            d: "Every project a teammate creates shows up for the whole team.",
          },
          {
            t: "Shared photos & reports",
            d: "Everyone can upload, annotate, and export with the same brand.",
          },
          {
            t: "Roles & permissions",
            d: "Owner, Admin, and Member roles control who can invite or remove.",
          },
          { t: "One bill, one team", d: "The owner's plan applies to every teammate." },
        ].map((f) => (
          <div
            key={f.t}
            className="rounded-2xl border border-border bg-card/[0.82] p-4 shadow-[0_20px_50px_-36px_rgba(16,25,41,0.5)]"
          >
            <div className="font-manrope text-sm font-extrabold text-foreground">{f.t}</div>
            <p className="mt-0.5 font-manrope text-xs text-muted-foreground">{f.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
function TeamDashboard({
  team,
  members,
  invites,
  myRole,
  plan,
  memberLimit,
  onChange,
}: {
  team: any;
  members: any[];
  invites: any[];
  myRole: string;
  plan: TeamPlan;
  memberLimit: number;
  onChange: () => void;
}) {
  // Inviting and removing is company-wide user management, so a Manager -
  // whose reach is their own crew - does not get it.
  const canManage = can(myRole, "manage_users");
  const isOwner = myRole === "owner";
  const seatsUsed = members.length + invites.length;
  const seatsLeft = Math.max(0, memberLimit - seatsUsed);
  const atCap = seatsLeft === 0;
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[1192px] px-6 pb-24 pt-10 md:px-10">
      <PageHeader
        eyebrow="Stay aligned"
        title={team.name || "Teams"}
        description="Manage the people who capture, review, and share your project record."
        actions={
          <>
            {/*
              No billing action here. Billing has one home - Settings → Billing
              - and duplicating the Stripe portal on this page meant two places
              to keep in sync and two places for a user to look. This page is
              about people and seats; upgrade paths still point at /pricing.
            */}
            {!isOwner && <LeaveTeamButton onLeft={onChange} />}
            {canManage && !atCap && (
              <Button
                onClick={() => setInviteOpen(true)}
                className="h-10 rounded-lg bg-primary px-5 font-manrope text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Invite teammate
              </Button>
            )}
          </>
        }
      />

      {atCap && canManage && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              {/*
               * Kept for Team too, unlike the coverage card. `memberLimit` here
               * is not the 50 ceiling - it prefers `teams.member_limit`, which
               * billing sets to the number of seats actually purchased. A Team
               * customer who bought 6 is genuinely at cap at 6, and this banner
               * is the only thing explaining why the Invite buttons vanished.
               */}
              <h2 className="font-manrope text-sm font-bold text-foreground">
                {plan === "team"
                  ? `All ${memberLimit} of your seats are in use`
                  : `${memberLimit}-seat limit reached`}
              </h2>
              <p className="font-manrope text-xs text-muted-foreground">
                {plan === "starter"
                  ? "Starter includes 2 users (you + 1), sharing the same projects. Upgrade to add more teammates."
                  : plan === "team"
                    ? "Add seats from Settings → Billing, or remove a member to free one up."
                    : "Remove a member or upgrade your plan to invite more."}
              </p>
            </div>
          </div>
          {plan === "starter" && (
            <Button asChild className="bg-primary hover:bg-primary/90">
              <Link to="/pricing">Upgrade plan</Link>
            </Button>
          )}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <MembersList members={members} myRole={myRole} plan={plan} onChange={onChange} />
        <WorkspaceCoverageCard
          seatsUsed={seatsUsed}
          memberLimit={memberLimit}
          plan={plan}
          canInvite={canManage && !atCap}
          onInviteClick={() => setInviteOpen(true)}
        />
      </div>

      {/* Below the roster, not inside it. A subcontractor holds no seat, so
          listing them among members would put a person in the crew list who
          never moves the seat count - the first thing an owner would query. */}
      <SubcontractorsPanel isTeamPlan={plan === "team"} />

      {invites.length > 0 && (
        <PendingInvites invites={invites} canManage={canManage} plan={plan} onChange={onChange} />
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={onChange}
        plan={plan}
        seatsLeft={seatsLeft}
      />
    </div>
  );
}

// ----------------------------------------------------------------
function WorkspaceCoverageCard({
  seatsUsed,
  memberLimit,
  plan,
  canInvite,
  onInviteClick,
}: {
  seatsUsed: number;
  memberLimit: number;
  plan: TeamPlan;
  canInvite: boolean;
  onInviteClick: () => void;
}) {
  return (
    <div className="flex flex-col rounded-3xl bg-sidebar p-6 text-sidebar-foreground">
      <Users className="h-7 w-7 text-sidebar-ring" />
      {/*
       * Team hides the ceiling. Starter and Pro ship a handful of seats, so the
       * remaining count is genuinely useful there - on Team it is a 50 that
       * nobody is approaching, and showing it reads as a restriction on a plan
       * whose whole pitch is "add the crew". The cap still exists and is still
       * enforced server-side (PLAN_MEMBER_CAP); it just isn't advertised.
       */}
      <p className="mt-10 font-manrope text-xs font-extrabold uppercase tracking-[1.8px] text-sidebar-ring">
        {plan === "team" ? "Your crew" : "Workspace coverage"}
      </p>
      <p className="font-display mt-3 text-5xl font-bold leading-none tracking-[-1.68px] text-sidebar-foreground">
        {plan === "team" ? seatsUsed : `${seatsUsed} / ${memberLimit}`}
      </p>
      <p className="mt-3 font-manrope text-sm leading-6 text-sidebar-foreground/60">
        {plan === "team"
          ? "People in your workspace. Bring in the rest of the crew whenever they're ready."
          : `Seats used on the ${PLAN_LABEL[plan]} plan. Bring in the rest of the crew when they are ready.`}
      </p>
      {canInvite && (
        <button
          type="button"
          onClick={onInviteClick}
          className="mt-6 self-start font-manrope text-sm font-extrabold text-sidebar-ring hover:underline"
        >
          Invite a teammate →
        </button>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
function InviteDialog({
  open,
  onOpenChange,
  onInvited,
  plan,
  seatsLeft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
  plan: TeamPlan;
  seatsLeft: number;
}) {
  const [email, setEmail] = useState("");
  const role: "admin" | "member" = "member";
  const invite = inviteMember;

  const m = useMutation({
    mutationFn: () =>
      invite({
        data: {
          email: email.trim(),
          role,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      }),
    onSuccess: (res: any) => {
      setEmail("");
      /*
       * Close on success, and say what happened in the toast.
       *
       * The dialog used to stay open with the email field reset to its
       * placeholder AND a panel showing the raw invite URL - which read as a
       * second modal appearing on top of the first. The link it showed is also
       * redundant: the invite now appears in Pending invites immediately, with
       * its own Copy link and Resend built from the same
       * `${origin}/invite/${token}`. A non-delivery is still a warning, not a
       * success, so the toast distinguishes the two.
       */
      if (res.emailSent) toast.success(`Invite email sent to ${res.invite.email}`);
      else
        toast.warning("Invite created, but the email couldn't be sent", {
          description: "Use Copy link next to the pending invite to share it directly.",
        });
      onInvited();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to invite"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setEmail("");
      }}
    >
      <DialogContent className="w-[448px] max-w-[448px] gap-0 rounded-[28px] border border-border bg-background p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] [&>button]:hidden">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle asChild>
                <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
                  SitePix workflow
                </p>
              </DialogTitle>
              <p className="mt-1 font-manrope text-xl font-extrabold text-foreground">
                Invite a teammate
              </p>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>

          <DialogDescription asChild>
            <p className="mt-5 font-manrope text-sm text-muted-foreground">
              Send an invitation to capture updates and collaborate on your projects.{" "}
              {/* Replaced wholesale rather than just dropping {seatsLeft} - the
                  count is fused into the sentence, so removing the number alone
                  would leave "…on your projects. seats left on the Team plan." */}
              {plan === "team"
                ? "They'll join your workspace as soon as they accept."
                : `${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left on the ${PLAN_LABEL[plan]} plan.`}
            </p>
          </DialogDescription>

          <div className="mt-5">
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                // Same guards the Send button carries. Without the isPending
                // check, Enter twice fired two invites: rpcOp mints a fresh
                // Idempotency-Key per call, so nothing downstream collapsed them
                // and both cleared the duplicate probe.
                if (e.key === "Enter" && email.trim() && !m.isPending) m.mutate();
              }}
              className="h-[48px] rounded-[14px] border-border bg-card/[0.92] font-manrope text-sm text-foreground shadow-[0_5px_12px_-12px_rgba(16,25,41,0.35)] placeholder:text-muted-foreground"
            />

            <button
              type="button"
              onClick={() => m.mutate()}
              disabled={!email.trim() || m.isPending}
              className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary font-manrope text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {m.isPending ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------
function PendingInvites({
  invites,
  canManage,
  plan,
  onChange,
}: {
  invites: any[];
  canManage: boolean;
  /** Only to name the pending role the way this tier names it. */
  plan: TeamPlan;
  onChange: () => void;
}) {
  const revoke = revokeInvite;
  const resend = resendInvite;
  const [busyId, setBusyId] = useState<string | null>(null);
  return (
    <div className="mt-6 rounded-3xl border border-border bg-card/[0.82] p-5 shadow-[0_20px_50px_-36px_rgba(16,25,41,0.5)] md:p-6">
      <div className="flex items-center gap-2">
        <h3 className="font-manrope text-xs font-extrabold uppercase tracking-[1px] text-muted-foreground">
          Pending invites
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 font-manrope text-xs font-bold text-muted-foreground">
          {invites.length}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {invites.map((inv: any) => {
          const link = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${inv.token}`;
          const expired = new Date(inv.expires_at).getTime() < Date.now();
          return (
            <li
              key={inv.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 sm:flex sm:flex-wrap sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate font-manrope text-sm font-extrabold text-foreground">
                  {inv.email}
                </div>
                {/* The tier's own word for the role, not the raw column. It
                    used to print the stored value with a CSS capitalize on it,
                    so a Pro workspace read "Member" by luck and a Team one would
                    have read "Member" wrongly. */}
                <div className="font-manrope text-xs text-muted-foreground">
                  {roleLabel(inv.role, plan)} ·{" "}
                  {expired ? (
                    <span className="text-destructive">expired</span>
                  ) : (
                    <>
                      expires{" "}
                      {relativeTime(inv.expires_at)
                        .replace(" ago", " from now")
                        .replace("just now", "soon")}
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(link);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Copy link</span>
                </Button>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === inv.id}
                    onClick={async () => {
                      setBusyId(inv.id);
                      try {
                        const res = await resend({
                          data: {
                            inviteId: inv.id,
                            origin:
                              typeof window !== "undefined" ? window.location.origin : undefined,
                          },
                        });
                        // Same reason as the invite dialog: a failed send is not
                        // a success, and wrapping both branches in toast.success
                        // is what made the UI claim delivery it hadn't achieved.
                        if ((res as any)?.emailSent)
                          toast.success(`Invite email re-sent to ${inv.email}`);
                        else toast.warning("Couldn't email - share the link instead");
                      } catch (e: any) {
                        toast.error(e?.message ?? "Couldn't resend invite");
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    <RefreshCcw
                      className={`h-3.5 w-3.5 sm:mr-1.5 ${busyId === inv.id ? "animate-spin" : ""}`}
                    />
                    <span className="hidden sm:inline">Resend</span>
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await revoke({ data: { inviteId: inv.id } });
                      toast.success("Invite revoked");
                      onChange();
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------
function MembersList({
  members,
  myRole,
  plan,
  onChange,
}: {
  members: any[];
  myRole: string;
  /** Decides which roles this team may hold - see `assignableRoles`. */
  plan: TeamPlan;
  onChange: () => void;
}) {
  const remove = removeMember;
  const updateRole = updateMemberRole;
  const [confirmRemove, setConfirmRemove] = useState<any | null>(null);
  const [query, setQuery] = useState("");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(null);

  /*
   * Someone who accepted their invite but never confirmed their email is on the
   * team and cannot sign in. Nothing said so, which is how a new hire ends up
   * "added" for days while the owner waits for them to start using it.
   *
   * `emailConfirmed` is null when the lookup itself failed - unknown, so no
   * claim is made either way.
   */
  const resendConfirmation = async (m: any) => {
    setResendingId(m.id);
    try {
      const res: any = await resendMemberConfirmation({
        data: {
          memberId: m.id,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (res?.alreadyConfirmed) {
        toast.success("They have already confirmed. Nothing to send.");
      } else if (res?.emailSent) {
        toast.success(`Confirmation email sent to ${m.profile?.email ?? "them"}`);
      } else {
        toast.warning("Could not send the confirmation email", {
          description: "Check the email settings, then try again.",
        });
      }
      onChange();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally {
      setResendingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name = (m.profile?.full_name ?? "").toLowerCase();
      const email = (m.profile?.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [members, query]);

  return (
    <div className="flex flex-col rounded-3xl border border-border bg-card/[0.82] shadow-[0_20px_50px_-36px_rgba(16,25,41,0.5)]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border p-5 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-manrope text-xs font-extrabold uppercase tracking-[1px] text-muted-foreground">
            Team members
          </h3>
          <span className="rounded-full bg-muted px-2 py-0.5 font-manrope text-xs font-bold text-muted-foreground">
            {members.length}
          </span>
        </div>
        {members.length > 3 && (
          <div className="relative w-full max-w-[220px] shrink-0 sm:w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members"
              className="h-8 pl-8 text-sm"
            />
          </div>
        )}
      </div>
      <ul className="divide-y divide-border">
        {filtered.length === 0 ? (
          <li className="py-6 text-center font-manrope text-sm text-muted-foreground">
            No members match "{query}"
          </li>
        ) : (
          filtered.map((m, idx) => {
            const name = m.profile?.full_name || m.profile?.email || "Unknown user";
            const email = m.profile?.email;
            // Same function the server enforces with, so the menu never
            // offers an action the RPC will refuse.
            const canEdit = canManageMember(myRole, m.role);
            const canRemove = (myRole === "owner" || myRole === "admin") && m.role !== "owner";
            const unconfirmed = m.emailConfirmed === false;
            /*
             * The roles this plan may hand out, plus - if it is not already in
             * there - the one this person actually holds.
             *
             * The second half matters for a workspace that downgraded, or that
             * held a Manager before Manager became Team-only. Their row still
             * says Manager, correctly, and without this the menu would open on
             * a list with no tick anywhere in it: the same "where do they stand
             * now?" dead end, reintroduced for exactly the people whose role is
             * least obvious. It renders disabled, so it says where they are
             * without offering to put anybody else there.
             */
            const currentRole = normaliseRole(m.role);
            const offered = assignableRoles(plan, { assignmentsEnforced: true });
            // Owner is never in the list: it is transferred, not assigned, and
            // `canEdit` is false for that row anyway.
            const roleOptions: AssignableRole[] =
              currentRole === "owner" || (offered as TeamRole[]).includes(currentRole)
                ? offered
                : [currentRole, ...offered];
            const canResend = myRole === "owner" || myRole === "admin";
            return (
              <li key={m.id} className="flex items-center justify-between gap-4 p-5">
                <div className="flex min-w-0 items-center gap-4">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-manrope text-xs font-extrabold text-white"
                    style={{ background: avatarColor(m.role, idx) }}
                  >
                    {initials(m.profile?.full_name, email)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-manrope text-sm font-extrabold text-foreground">
                        {name}
                      </span>
                      {/*
                        The role, as a badge, on the row.
                        Until this landed the only trace of somebody's role was
                        the sentence below in muted grey, which reads as status
                        text next to "Active 2h ago" rather than as a
                        permission. An owner scanning the roster could not tell
                        their two Admins from their four Members without reading
                        every line. A permission you cannot see is a permission
                        you cannot audit.
                      */}
                      <RoleBadge role={m.role} tier={plan} />
                      {unconfirmed && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 font-manrope text-[10px] font-extrabold uppercase tracking-[0.5px] text-amber-600 dark:text-amber-400">
                          Email not confirmed
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-manrope text-xs text-muted-foreground">
                      {roleTitle(m.role, plan)}
                      {unconfirmed ? (
                        <> · Cannot sign in until they confirm their email</>
                      ) : (
                        m.created_at && (
                          <> · Active {relativeTime(m.created_at).replace("just now", "now")}</>
                        )
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {unconfirmed && canResend && (
                    <button
                      type="button"
                      disabled={resendingId === m.id}
                      onClick={() => resendConfirmation(m)}
                      className="rounded-xl bg-primary/10 px-3 py-2 font-manrope text-xs font-extrabold text-primary transition hover:bg-primary/15 disabled:opacity-60"
                    >
                      {resendingId === m.id ? "Sending…" : "Resend confirmation"}
                    </button>
                  )}
                  {canEdit || canRemove ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="rounded-xl bg-muted px-3 py-2 font-manrope text-xs font-extrabold text-muted-foreground transition hover:bg-accent"
                        >
                          Manage
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
                        {/*
                          The whole list, with the current one marked, and each
                          one saying what it grants.

                          Two separate reports, one shape. The menu used to
                          FILTER OUT the role the member already held, so
                          reopening it showed no tick, no highlight and no
                          mention of where they stand - the only way to answer
                          "what is this person now?" was to close the menu and
                          read the row. And every remaining row was two words,
                          "Make Manager", with the difference between the roles
                          written down nowhere a customer could reach. Both are
                          the same failure: a permissions picker that does not
                          state the permissions.

                          So the current role stays in the list, disabled and
                          ticked, and every row carries its one-liner from the
                          shared matrix - the same sentences the server gates on.
                        */}
                        {canEdit && (
                          <>
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Role
                            </DropdownMenuLabel>
                            {roleOptions.map((role) => {
                              const isCurrent = role === currentRole;
                              return (
                                <DropdownMenuItem
                                  key={role}
                                  disabled={isCurrent}
                                  /*
                                   * `data-[disabled]:opacity-100`, not a plain
                                   * `opacity-100`. Radix dims a disabled item
                                   * with `data-[disabled]:opacity-50`, and a
                                   * bare opacity utility does not conflict with
                                   * a variant one, so tailwind-merge kept both
                                   * and the browser applied the variant. The
                                   * screenshot showed the current role as the
                                   * FAINTEST row in the menu, which is the
                                   * opposite of the point.
                                   */
                                  className={
                                    isCurrent
                                      ? "bg-accent/60 data-[disabled]:opacity-100"
                                      : undefined
                                  }
                                  onClick={async () => {
                                    if (isCurrent) return;
                                    try {
                                      const res: any = await updateRole({
                                        data: { memberId: m.id, role },
                                      });
                                      /*
                                       * Restricted is the one role where the
                                       * next question is always "which jobs?".
                                       * Whatever crew rows this person already
                                       * had just became their entire view of
                                       * the workspace, so the toast says how
                                       * many that is and the picker opens
                                       * rather than waiting to be found.
                                       */
                                      if (role === "restricted") {
                                        const n = res?.scopedProjectCount ?? 0;
                                        toast.success(`Set as ${roleLabel(role, plan)}`, {
                                          description:
                                            n === 0
                                              ? "They cannot open any job until you pick some."
                                              : `They keep the ${n} job${n === 1 ? "" : "s"} they are already on, and nothing else.`,
                                        });
                                        setAssigning({ id: m.id, name });
                                      } else {
                                        toast.success(`Set as ${roleLabel(role, plan)}`);
                                      }
                                      onChange();
                                    } catch (e: any) {
                                      toast.error(e?.message ?? "Could not change role");
                                    }
                                  }}
                                >
                                  <span className="mr-2 flex h-4 w-4 shrink-0 items-center justify-center">
                                    {isCurrent ? (
                                      <Check className="h-4 w-4 text-primary" />
                                    ) : (
                                      <Shield className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block font-semibold">
                                      {roleLabel(role, plan)}
                                      {isCurrent && (
                                        <span className="ml-1.5 font-normal text-muted-foreground">
                                          {offered.includes(role as never)
                                            ? "(current)"
                                            : "(current, not on this plan)"}
                                        </span>
                                      )}
                                    </span>
                                    <span className="block text-xs font-normal leading-snug text-muted-foreground">
                                      {roleTitle(role, plan)}
                                    </span>
                                  </span>
                                </DropdownMenuItem>
                              );
                            })}
                          </>
                        )}
                        {/*
                          Only Restricted members are scoped, so this is the
                          only role for which "which jobs?" is a question - and
                          Restricted is Team-only, so on Pro this row is absent
                          rather than present-and-inert. Putting somebody on a
                          job is a different thing and lives on the project
                          itself, where every plan has it.
                        */}
                        {canEdit &&
                          tierHasJobScoping(plan) &&
                          normaliseRole(m.role) === "restricted" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setAssigning({ id: m.id, name })}>
                                <UserIcon className="mr-2 h-4 w-4" />
                                <span className="min-w-0">
                                  <span className="block font-semibold">Choose their jobs</span>
                                  <span className="block text-xs font-normal leading-snug text-muted-foreground">
                                    The jobs you tick are the only ones they can open.
                                  </span>
                                </span>
                              </DropdownMenuItem>
                            </>
                          )}
                        {/*
                          The honest version of the upsell: it names what is
                          missing rather than the plan. Shown only to someone
                          who is actually picking a role, and only where the
                          missing tiers are real - a Team workspace sees the
                          full list and never sees this.
                        */}
                        {canEdit && plan !== "team" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link to="/pricing">
                                <Sparkles className="mr-2 h-4 w-4 text-primary" />
                                <span className="min-w-0">
                                  <span className="block font-semibold">Need a middle tier?</span>
                                  <span className="block text-xs font-normal leading-snug text-muted-foreground">
                                    Managers, and scoping someone to named jobs, are on Team.
                                  </span>
                                </span>
                              </Link>
                            </DropdownMenuItem>
                          </>
                        )}
                        {canRemove && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setConfirmRemove(m)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Remove from team
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title={`${roleLabel(m.role, plan)} - no actions available`}
                      className="cursor-default rounded-xl bg-muted px-3 py-2 font-manrope text-xs font-extrabold text-muted-foreground/50"
                    >
                      Manage
                    </button>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>

      <AssignJobsDialog
        member={assigning}
        onClose={() => {
          setAssigning(null);
          onChange();
        }}
      />

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove teammate?</DialogTitle>
            <DialogDescription>
              {confirmRemove?.profile?.email ?? "This user"} will lose access to all team projects.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await remove({ data: { memberId: confirmRemove.id } });
                toast.success("Removed");
                setConfirmRemove(null);
                onChange();
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ----------------------------------------------------------------
function LeaveTeamButton({ onLeft }: { onLeft: () => void }) {
  const [open, setOpen] = useState(false);
  const leave = leaveTeam;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LogOut className="mr-2 h-4 w-4" /> Leave team
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this team?</DialogTitle>
            <DialogDescription>You'll lose access to all shared projects.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await leave();
                toast.success("Left team");
                setOpen(false);
                onLeft();
              }}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
