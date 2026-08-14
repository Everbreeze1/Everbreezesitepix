import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Crown,
  Shield,
  User as UserIcon,
  FolderKanban,
  Images,
  Sparkles,
  Video,
  Droplet,
  FileText,
  Map,
  ListChecks,
  Activity,
  Camera,
  CheckSquare,
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getMyTeam, getTeamActivity, type TeamActivityItem } from "@/lib/teams.functions";
import { supabase } from "@/integrations/sitepix/client";
import { relativeTime } from "@sitepix/shared";

const roleIcon = (r: string) =>
  r === "owner" ? (
    <Crown className="h-3 w-3" />
  ) : r === "admin" ? (
    <Shield className="h-3 w-3" />
  ) : (
    <UserIcon className="h-3 w-3" />
  );

const roleLabel: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

const SHARED_FEATURES = [
  {
    icon: FolderKanban,
    title: "Shared Project Access",
    desc: "Every project created by the team is visible to all members.",
  },
  {
    icon: Images,
    title: "Real-time Photo Updates",
    desc: "Photos uploaded on site sync instantly across every device.",
  },
  {
    icon: Video,
    title: "Walkthrough Recorder",
    desc: "Capture narrated site walkthroughs and share with the team.",
  },
  {
    icon: Droplet,
    title: "Company Watermarking",
    desc: "All shared photos carry your company brand automatically.",
  },
  {
    icon: FileText,
    title: "Automated Reports",
    desc: "Generate branded PDF reports from any project in one click.",
  },
  {
    icon: Sparkles,
    title: "AI-Powered Reports",
    desc: "Site logs, walkthrough recaps, and photo captions drafted automatically.",
  },
  {
    icon: ListChecks,
    title: "Checklists & Task Tools",
    desc: "Apply templates and track completion across every project.",
  },
  {
    icon: Map,
    title: "Live Project Map",
    desc: "See all active job sites on a single live map view.",
  },
] as const;

export function CollaboratorsPage() {
  const fetchTeam = getMyTeam;
  const fetchActivity = getTeamActivity;
  const { data, isLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
  });

  const teamReady = !!data?.team;

  const stats = useQuery({
    queryKey: ["collab-stats"],
    enabled: teamReady,
    queryFn: async () => {
      const [{ count: projects }, { count: photos }, { data: recent }] = await Promise.all([
        supabase.from("projects").select("id", { count: "exact", head: true }),
        supabase.from("photos").select("id", { count: "exact", head: true }),
        supabase
          .from("projects")
          .select("id, name, status, updated_at")
          .order("updated_at", { ascending: false })
          .limit(5),
      ]);
      return {
        projects: projects ?? 0,
        photos: photos ?? 0,
        recent:
          (recent as Array<{
            id: string;
            name: string;
            status: string | null;
            updated_at: string;
          }>) ?? [],
      };
    },
  });

  const activity = useQuery({
    queryKey: ["team-activity"],
    enabled: teamReady,
    queryFn: () => fetchActivity(),
    staleTime: 15_000,
  });

  if (isLoading) {
    return null;
  }

  if (!teamReady) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">No team yet</h1>
        <p className="mt-2 text-muted-foreground">You're not part of a team workspace.</p>
      </div>
    );
  }

  const members = (data.members ?? []) as any[];
  const owner = members.find((m) => m.role === "owner");
  const ownerName = owner?.profile?.full_name ?? owner?.profile?.email ?? "Account owner";

  // pb-24, not pb-20: the floating camera button occupies 84px of the
  // bottom-right corner, so 80px left it grazing the last card.
  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 pb-24 pt-8 md:pt-12">
      {/* Hero / overview */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-subtle p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{data.team.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Owned by <span className="font-medium text-foreground">{ownerName}</span> ·{" "}
                {members.length} {members.length === 1 ? "member" : "members"}
              </p>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                All projects created by team members are visible here. Collaborate seamlessly -
                every photo, walkthrough, and report stays in sync across the team.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Quick stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={FolderKanban}
          label="Total Projects"
          value={stats.data?.projects ?? "-"}
          loading={stats.isLoading}
        />
        <StatCard
          icon={Images}
          label="Photos Captured"
          value={stats.data?.photos ?? "-"}
          loading={stats.isLoading}
        />
        <StatCard icon={Users} label="Team Members" value={members.length} />
      </div>

      {/* Members (with contributions) + Recent activity feed */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5 md:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">Team contributions</h2>
            <Badge variant="outline" className="text-xs">
              {members.length}
            </Badge>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {(
              activity.data?.members ??
              members.map((m) => ({
                userId: m.user_id,
                fullName: m.profile?.full_name ?? null,
                email: m.profile?.email ?? null,
                avatarUrl: m.profile?.avatar_url ?? null,
                role: m.role,
                photos: 0,
                tasks: 0,
                reports: 0,
                lastActivityAt: null,
              }))
            ).map((m: any) => {
              const name = m.fullName ?? null;
              const email = m.email ?? null;
              const total = (m.photos ?? 0) + (m.tasks ?? 0) + (m.reports ?? 0);
              return (
                <li
                  key={m.userId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={m.avatarUrl ?? undefined} />
                      <AvatarFallback>{initials(name, email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {name ?? email ?? "Member"}
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 capitalize border-primary/30 text-[10px] text-primary"
                        >
                          {roleIcon(m.role)}
                          <span className="ml-1">{roleLabel[m.role] ?? m.role}</span>
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {total > 0 ? (
                          <>
                            <span>{m.photos} photos</span>
                            <span>· {m.tasks} tasks</span>
                            <span>· {m.reports} reports</span>
                          </>
                        ) : (
                          <span>No contributions yet</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    {m.lastActivityAt ? relativeTime(m.lastActivityAt) : "-"}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5 md:p-6">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground">Recent activity</h2>
          </div>
          {activity.isLoading ? null : activity.data?.recent?.length ? (
            <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {activity.data.recent.map((it) => (
                <ActivityRow key={it.id} item={it} />
              ))}
            </ul>
          ) : stats.data?.recent.length ? (
            <ul className="mt-3 divide-y divide-border">
              {stats.data.recent.map((p) => (
                <li key={p.id} className="py-2.5">
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: p.id }}
                    className="flex items-center justify-between gap-3 hover:text-primary"
                  >
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground capitalize">
                      {p.status ?? "active"} · {relativeTime(p.updated_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No activity yet - once teammates upload photos, create tasks, or generate reports
              it'll show up here.
            </p>
          )}
        </Card>
      </div>

      {/* Shared features */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            What's included for the whole team
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SHARED_FEATURES.map((f) => (
            <Card
              key={f.title}
              className="p-4 transition hover:border-primary/50 hover:shadow-elegant"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-[18px] w-[18px]" />
              </div>
              <div className="mt-3 text-sm font-semibold">{f.title}</div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </Card>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Only the account owner can invite, remove, or change roles for teammates.
      </p>
    </div>
  );
}

const KIND_META: Record<TeamActivityItem["kind"], { icon: any; label: string; color: string }> = {
  photo: { icon: Camera, label: "uploaded a photo", color: "text-sky-600 bg-sky-500/10" },
  task: { icon: CheckSquare, label: "created a task", color: "text-amber-600 bg-amber-500/10" },
  report: { icon: FilePlus, label: "built a report", color: "text-primary bg-primary/10" },
  project: {
    icon: FolderPlus,
    label: "started a project",
    color: "text-emerald-600 bg-emerald-500/10",
  },
};

function ActivityRow({ item }: { item: TeamActivityItem }) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const actor = item.actorName ?? item.actorEmail ?? "Someone";
  const titleLine = item.title?.trim() ? (
    <span className="truncate text-muted-foreground">"{item.title.trim()}"</span>
  ) : null;

  const inner = (
    <div className="flex items-start gap-3 rounded-md border border-border bg-card/40 p-2.5 transition hover:border-primary/40 hover:bg-card">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <span className="truncate font-medium">{actor}</span>
          <span className="text-muted-foreground">{meta.label}</span>
          {item.projectName && (
            <>
              <span className="text-muted-foreground">in</span>
              <span className="truncate font-medium">{item.projectName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {titleLine}
          <span className="ml-auto shrink-0 text-muted-foreground">{relativeTime(item.at)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <li>
      {item.projectId ? (
        <Link to="/projects/$projectId" params={{ projectId: item.projectId }} className="block">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: any;
  label: string;
  value: number | string;
  loading?: boolean;
}) {
  return (
    <Card className="p-4 transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold leading-tight">{loading ? null : value}</div>
        </div>
      </div>
    </Card>
  );
}
