import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Trash2,
  Copy,
  Check,
  Crown,
  Shield,
  User as UserIcon,
  Send,
  LogOut,
  Sparkles,
  Lock,
  CreditCard,
  Search,
  RefreshCcw,
  UserPlus,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  createBillingPortalSession,
} from "@/features/teams/api";
import { relativeTime } from "@sitepix/shared";

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

const roleLabel: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const roleTitle: Record<string, string> = {
  owner: "Workspace admin",
  admin: "Project manager",
  member: "Crew member",
};

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

  // Only the team owner can access the Teams settings page.
  // Members/admins were invited — they shouldn't see plan, seats, or invites.
  if (data.myRole !== "owner") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Team settings are owner-only
        </h1>
        <p className="mt-2 font-manrope text-sm text-muted-foreground">
          You're a member of <strong className="text-foreground">{data.team.name}</strong>. Only the
          team owner can manage members, invites, and the plan.
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
      sharingEnabled={!!data.sharingEnabled}
      onChange={invalidate}
    />
  );
}

// ----------------------------------------------------------------
// Static design preview matching the Figma "Teams" mock — shown whenever
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
    <div className="mx-auto max-w-[1192px] px-6 py-10 md:px-10">
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
                      {roleTitle[m.role]} · Active {m.active}
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
    <div className="mx-auto max-w-[1192px] px-6 py-10 md:px-10">
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
  sharingEnabled,
  onChange,
}: {
  team: any;
  members: any[];
  invites: any[];
  myRole: string;
  plan: TeamPlan;
  memberLimit: number;
  sharingEnabled: boolean;
  onChange: () => void;
}) {
  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const seatsUsed = members.length + invites.length;
  const seatsLeft = Math.max(0, memberLimit - seatsUsed);
  const atCap = seatsLeft === 0;
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[1192px] px-6 py-10 md:px-10">
      <PageHeader
        eyebrow="Stay aligned"
        title={team.name || "Teams"}
        description="Manage the people who capture, review, and share your project record."
        actions={
          <>
            {isOwner && <ManageBillingButton />}
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

      {!sharingEnabled && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-manrope text-sm font-bold text-foreground">
              Project sharing is off on Starter
            </div>
            <p className="mt-0.5 font-manrope text-xs text-muted-foreground">
              Starter teams can add 1 additional user, but each person keeps their own projects.
              Upgrade to <strong>Pro</strong> or <strong>Team</strong> to share projects, photos,
              and reports across the team.
            </p>
          </div>
          <Button asChild size="sm" className="shrink-0 bg-primary hover:bg-primary/90">
            <Link to="/pricing">Upgrade</Link>
          </Button>
        </div>
      )}

      {atCap && canManage && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-manrope text-sm font-bold text-foreground">
                {memberLimit}-seat limit reached
              </h2>
              <p className="font-manrope text-xs text-muted-foreground">
                {plan === "starter"
                  ? "Starter includes 2 users (you + 1). Upgrade to add more teammates and share projects."
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
        <MembersList members={members} myRole={myRole} onChange={onChange} />
        <WorkspaceCoverageCard
          seatsUsed={seatsUsed}
          memberLimit={memberLimit}
          plan={plan}
          canInvite={canManage && !atCap}
          onInviteClick={() => setInviteOpen(true)}
        />
      </div>

      {invites.length > 0 && (
        <PendingInvites invites={invites} canManage={canManage} onChange={onChange} />
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
function ManageBillingButton() {
  const openPortal = createBillingPortalSession;
  const m = useMutation({
    mutationFn: () =>
      openPortal({
        data: { origin: typeof window !== "undefined" ? window.location.origin : "" },
      }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to open billing portal"),
  });
  return (
    <Button variant="outline" disabled={m.isPending} onClick={() => m.mutate()}>
      <CreditCard className="mr-2 h-4 w-4" />
      {m.isPending ? "Opening…" : "Manage billing"}
    </Button>
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
      <p className="mt-10 font-manrope text-xs font-extrabold uppercase tracking-[1.8px] text-sidebar-ring">
        Workspace coverage
      </p>
      <p className="font-display mt-3 text-5xl font-bold leading-none tracking-[-1.68px] text-sidebar-foreground">
        {seatsUsed} / {memberLimit}
      </p>
      <p className="mt-3 font-manrope text-sm leading-6 text-sidebar-foreground/60">
        Seats used on the {PLAN_LABEL[plan]} plan. Bring in the rest of the crew when they are
        ready.
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
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [lastEmailSent, setLastEmailSent] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
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
      const link = `${window.location.origin}/invite/${res.invite.token}`;
      setLastLink(link);
      setLastEmailSent(!!res.emailSent);
      setEmail("");
      toast.success(
        res.emailSent
          ? `Invite email sent to ${res.invite.email}`
          : "Invite created — share the link below",
      );
      onInvited();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to invite"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setLastLink(null);
          setLastEmailSent(false);
          setEmail("");
        }
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
              Send an invitation to capture updates and collaborate on your projects. {seatsLeft}{" "}
              {seatsLeft === 1 ? "seat" : "seats"} left on the {PLAN_LABEL[plan]} plan.
            </p>
          </DialogDescription>

          <div className="mt-5">
            <Input
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email) m.mutate();
              }}
              className="h-[48px] rounded-[14px] border-border bg-card/[0.92] font-manrope text-sm text-foreground shadow-[0_5px_12px_-12px_rgba(16,25,41,0.35)] placeholder:text-muted-foreground"
            />

            {lastLink && (
              <div className="mt-3 rounded-xl border border-border bg-card/70 p-3">
                <p className="font-manrope text-xs font-semibold text-primary">
                  {lastEmailSent
                    ? "Email sent · backup invite link"
                    : "Invite link (email not sent)"}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 font-manrope text-xs text-foreground">
                    {lastLink}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(lastLink);
                      setCopied(true);
                      toast.success("Link copied");
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2 font-manrope text-[11px] text-muted-foreground">
                  Expires in 14 days.
                </p>
              </div>
            )}

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
  onChange,
}: {
  invites: any[];
  canManage: boolean;
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
                <div className="font-manrope text-xs capitalize text-muted-foreground">
                  {inv.role} ·{" "}
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
                        toast.success(
                          (res as any)?.emailSent
                            ? `Invite email re-sent to ${inv.email}`
                            : "Couldn't email — share the link instead",
                        );
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
  onChange,
}: {
  members: any[];
  myRole: string;
  onChange: () => void;
}) {
  const remove = removeMember;
  const updateRole = updateMemberRole;
  const [confirmRemove, setConfirmRemove] = useState<any | null>(null);
  const [query, setQuery] = useState("");

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
            const canEdit = myRole === "owner" && m.role !== "owner";
            const canRemove = (myRole === "owner" || myRole === "admin") && m.role !== "owner";
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
                    <div className="truncate font-manrope text-sm font-extrabold text-foreground">
                      {name}
                    </div>
                    <div className="mt-0.5 truncate font-manrope text-xs text-muted-foreground">
                      {roleTitle[m.role] ?? roleLabel[m.role] ?? m.role}
                      {m.created_at && (
                        <> · Active {relativeTime(m.created_at).replace("just now", "now")}</>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
                      <DropdownMenuContent align="end">
                        {canEdit && m.role !== "admin" && (
                          <DropdownMenuItem
                            onClick={async () => {
                              await updateRole({ data: { memberId: m.id, role: "admin" } });
                              toast.success("Promoted to admin");
                              onChange();
                            }}
                          >
                            <Shield className="mr-2 h-4 w-4" /> Make admin
                          </DropdownMenuItem>
                        )}
                        {canEdit && m.role !== "member" && (
                          <DropdownMenuItem
                            onClick={async () => {
                              await updateRole({ data: { memberId: m.id, role: "member" } });
                              toast.success("Set as member");
                              onChange();
                            }}
                          >
                            <UserIcon className="mr-2 h-4 w-4" /> Make member
                          </DropdownMenuItem>
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
                      title={`${roleLabel[m.role] ?? m.role} — no actions available`}
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
