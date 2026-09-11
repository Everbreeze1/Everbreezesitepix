import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FolderKanban,
  Images,
  Users,
  LifeBuoy,
  Crown,
  Map,
  LayoutTemplate,
  HelpCircle,
  ClipboardList,
  FileText,
  Layers,
  Lock,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useQuery } from "@tanstack/react-query";
import { getMyTeam } from "@/lib/teams.functions";
import { checkIsPlatformAdmin } from "@/lib/admin.functions";

/*
 * Sidebar nav, grouped exactly like the Main-html reference: a "Workspace"
 * group (Overview, Projects, Photo Library, Maps), a "Set up" group
 * (Blueprints, Checklists, Documents, Teams) and a "Client-facing" group
 * (Portfolio). The templates hub is one page with deep-linkable tabs, so the
 * three template-library rows share /templates and differ only in ?tab=.
 */
type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  locked?: boolean;
  tab?: "checklists" | "documents";
};

const workspaceItems: NavItem[] = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Photo Library", url: "/gallery", icon: Images },
  { title: "Maps", url: "/map", icon: Map },
];

const blueprintsItem: NavItem = { title: "Blueprints", url: "/templates", icon: LayoutTemplate };
// "Checklists" and "Documents" live on the Templates hub too; the tab search
// param picks which panel opens, and lights up which row reads as active.
const checklistsItem: NavItem = {
  title: "Checklists",
  url: "/templates",
  icon: ClipboardList,
  tab: "checklists",
};
const documentsItem: NavItem = {
  title: "Documents",
  url: "/templates",
  icon: FileText,
  tab: "documents",
};
const teamItem: NavItem = { title: "Teams", url: "/teams", icon: Users };
const collabItem: NavItem = { title: "Collaborators", url: "/collaborators", icon: Users };
// The page behind /showcases is the whole portfolio mini-site (site + project
// pages + website embeds), so "Portfolio" is what it actually is.
const portfolioItem: NavItem = { title: "Portfolio", url: "/showcases", icon: Layers };
const pricingItem: NavItem = { title: "Upgrade", url: "/pricing", icon: Crown };
// "Knowledge Base" rather than "Help Center": this row is an article library.
const helpItem: NavItem = { title: "Knowledge Base", url: "/help", icon: HelpCircle };
// Covers bugs *and* feature suggestions now, so "Report issue" undersold it.
const reportIssueItem: NavItem = { title: "Feedback", url: "/report-issue", icon: LifeBuoy };
/*
 * The admin dashboard had no link anywhere in the product - five pages, a
 * route tree and a server-side gate all shipped, reachable only by typing
 * /admin from memory. Unlike the plan-gated rows above, this one is genuinely
 * absent for non-admins rather than badged: platform admin is not a tier
 * anyone can buy, and advertising the console to every customer only invites
 * them to knock on a door that will not open.
 */
const adminItem: NavItem = { title: "Admin", url: "/admin", icon: ShieldCheck };

function getInitials(name?: string | null, email?: string | null) {
  const trimmed = name?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

export function AppSidebar() {
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchParams = useRouterState({ select: (s) => s.location.search }) as {
    tab?: unknown;
  };
  /*
   * Templates-hub tab, read from the URL so the three template rows each light
   * up only when their own panel is showing. "blueprints" (or absent) is the
   * hub's default, so both normalize to undefined for active-row detection.
   */
  const rawTab = searchParams.tab;
  const templateTab =
    rawTab === undefined || rawTab === "blueprints"
      ? undefined
      : rawTab === "checklists" || rawTab === "documents"
        ? rawTab
        : undefined;
  const { user } = useAuth();
  const { profile } = useProfile();

  const fetchTeam = getMyTeam;
  // The team row shape (plan gates, portfolio access) is intentionally read as
  // `any`, matching the rest of the app: the endpoint is shared and produces a
  // looser union than the fields this rail needs to branch on.
  const { data: teamData } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
    enabled: !!user,
    staleTime: 30_000,
  });

  const isInvitedMember =
    !!teamData && !!teamData.team && !!teamData.myRole && teamData.myRole !== "owner";
  const showOwnerNav = !isInvitedMember;
  // Templates: Pro/Team plans only. Visible to all team members on that plan
  // (they can apply templates); only owners/admins can create/edit (enforced on the page).
  const plan: string = (teamData?.plan as string | undefined) ?? "starter";
  const showTemplates = plan === "pro" || plan === "team";
  /*
   * Full Team access, named once because two rows read it: the Portfolio gate
   * below, and whether "Upgrade" is worth showing at all. Internal /
   * complimentary teams count as Team here, the same way useSubscription()
   * treats them.
   */
  const hasTeamAccess = !!teamData?.isInternal || (!!teamData?.isActive && plan === "team");
/*
   * Portfolio is a Team-tier feature, but it is *badged*, never removed.
   *
   * Dropping the row from the array is what produced "the Portfolio is still
   * not showing": a team on the Team plan whose `subscription_status` is
   * anything other than "active" (trialing, past_due, or simply never written)
   * got no nav row, no page, and no explanation - while Templates, which
   * checks `plan` alone, stayed visible right above it. PortfolioPage already
   * renders the upsell for a locked account; showing the row leaks nothing
   * because the API and RLS gate on team membership.
   */
  const portfolioLocked = !hasTeamAccess;

  /*
   * Gated on the same server check the admin layout uses, so the row and the
   * page can never disagree. A non-admin who reaches /admin by hand still gets
   * the layout's "Admin access required" screen; hiding the row is a
   * convenience, never the security boundary.
   */
  const { data: adminCheck } = useQuery({
    queryKey: ["admin", "check"],
    queryFn: () => checkIsPlatformAdmin(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const setupItems: NavItem[] = [
    ...(showTemplates ? [blueprintsItem, checklistsItem, documentsItem] : []),
  ];
  const clientFacingItems: NavItem[] = [{ ...portfolioItem, locked: portfolioLocked }];
  const teamsRow: NavItem = showOwnerNav ? teamItem : collabItem;

  /*
   * "Upgrade" is only a row while there is something left to upgrade to: Team
   * is the top self-serve tier, so on it this crown advertised the plan the
   * account already pays for.
   */
  const utilItems: NavItem[] = [
    ...(showOwnerNav && !hasTeamAccess ? [pricingItem] : []),
    helpItem,
    reportIssueItem,
    ...(adminCheck?.isAdmin ? [adminItem] : []),
  ];

  const displayName = profile?.full_name || user?.email || "";
  const initials = getInitials(profile?.full_name, user?.email);
  const companyName = (teamData as { team?: { name?: string } } | null | undefined)?.team?.name;

  const buttonBase =
    "relative flex items-center rounded-lg px-3 text-[13.5px] font-semibold transition-colors" +
    (isMobile ? " h-[52px] gap-3 text-[15px]" : " h-(--rail-row) gap-[11px]");
  const iconBase = isMobile ? "h-5 w-5" : "h-[18px] w-[18px]";
const navButtonClass = (active: boolean) =>
    `${buttonBase} ${
      active
        ? "bg-sidebar-accent text-sidebar-ring"
        : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
    }`;
  const navIconClass = (active: boolean) =>
    `${iconBase} ${active ? "text-sidebar-ring" : "text-sidebar-foreground/45"}`;

  const isActive = (item: { url: string; tab?: string }) => {
    if (item.url === "/templates") {
      const mine = item.tab ?? undefined;
      return (
        pathname === "/templates" &&
        (mine === templateTab || (mine === undefined && templateTab === undefined))
      );
    }
    return pathname === item.url || pathname.startsWith(item.url + "/");
  };

  const renderNavRow = (item: NavItem) => {
    const active = isActive(item);
    return (
      <SidebarMenuItem key={item.url + (item.tab ?? "")}>
        <SidebarMenuButton asChild isActive={active} className={navButtonClass(active)}>
          <Link to={item.url} search={item.tab ? { tab: item.tab } : undefined}>
            {/*
              Kept in a wrapper: SidebarMenuButton's own variant carries
              `[&>svg]:size-4`, which outranks a class set on the svg and would
              pin every icon to 16px, mobile included.
            */}
            <span className="flex shrink-0 items-center">
              <item.icon className={navIconClass(active)} />
            </span>
            {!collapsed && <span>{item.title}</span>}
            {!collapsed && item.locked && (
              <span className="ml-auto flex shrink-0 items-center">
                <Lock className="h-3.5 w-3.5 text-sidebar-foreground/40" aria-hidden />
                <span className="sr-only">Team plan</span>
              </span>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const groupLabelClass =
    "mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/45";

  return (
    <Sidebar collapsible="icon" className="border-r-0 bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="px-5 py-5 [@media(max-height:719px)]:py-3">
        <Link to="/dashboard" className="flex items-center gap-2.5">
          <BrandLogo size={collapsed ? 28 : 24} />
          {!collapsed && (
            <span className="text-base font-bold leading-tight tracking-[-0.01em] text-sidebar-foreground">
              Ever<span className="text-brand-gold">lumen</span>
            </span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent className="scroll-slim gap-0 px-2">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className={groupLabelClass}>Workspace</SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={isMobile ? "gap-1.5" : "gap-(--rail-gap)"}>
              {workspaceItems.map(renderNavRow)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
<SidebarGroup className="mt-5">
          {!collapsed && (
            <SidebarGroupLabel className={groupLabelClass}>Set up</SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={isMobile ? "gap-1.5" : "gap-(--rail-gap)"}>
              {setupItems.map(renderNavRow)}
              {renderNavRow(teamsRow)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-5">
          {!collapsed && (
            <SidebarGroupLabel className={groupLabelClass}>Client-facing</SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={isMobile ? "gap-1.5" : "gap-(--rail-gap)"}>
              {clientFacingItems.map(renderNavRow)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-2 pb-2.5 pt-1">
        <div className={`flex flex-col ${isMobile ? "gap-1.5" : "gap-(--rail-gap)"}`}>
          {utilItems.map((item) => (
            <Link
              key={item.url}
              to={item.url}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[12.5px] transition-colors ${
                isActive(item)
                  ? "bg-sidebar-accent text-sidebar-ring"
                  : "text-sidebar-foreground/55 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <item.icon
                className={`h-[15px] w-[15px] shrink-0 ${
                  isActive(item) ? "text-sidebar-ring" : "text-sidebar-foreground/40"
                }`}
              />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          ))}
        </div>
        {user && (
          <Link
            to="/settings"
            className={`mt-2 flex items-center gap-3 rounded-lg px-3 transition-colors hover:bg-sidebar-accent ${
              isMobile ? "h-14" : "h-11"
            }`}
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[11px] font-bold text-sidebar-foreground">
                {initials}
              </span>
            )}
            {!collapsed && (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12.5px] font-semibold text-sidebar-foreground">
                  {displayName}
                </span>
                <span className="truncate text-[11px] text-sidebar-foreground/40">
                  {companyName || "Account & settings"}
                </span>
              </span>
            )}
          </Link>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}