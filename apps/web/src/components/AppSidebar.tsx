import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FolderKanban,
  Images,
  Users,
  LogOut,
  LifeBuoy,
  Crown,
  Map,
  LayoutTemplate,
  HelpCircle,
  ChevronRight,
  Layers,
  Lock,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getMyTeam } from "@/lib/teams.functions";
import { getTrashCounts } from "@/lib/trash.functions";

const baseItems = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Maps", url: "/map", icon: Map },
  { title: "Gallery", url: "/gallery", icon: Images },
] as const;
const teamItem = { title: "Teams", url: "/teams", icon: Users } as const;
const collabItem = { title: "Collaborators", url: "/collaborators", icon: Users } as const;
const templatesItem = { title: "Templates", url: "/templates", icon: LayoutTemplate } as const;
// No Timeline item: the company-wide timeline was the gallery's calendar with
// fewer controls behind a Pro gate, so it lives at /gallery (Calendar) now.
// The page behind /showcases is now the whole portfolio mini-site (site +
// project pages + website embeds), so "Portfolio" is what it actually is.
const showcasesItem = { title: "Portfolio", url: "/showcases", icon: Layers } as const;
const pricingItem = { title: "Upgrade", url: "/pricing", icon: Crown } as const;
/*
 * Deleting is reversible for 60 days, but only if you can find where the
 * deleted things went. The trash screen has existed the whole time - route,
 * page, restore and purge, retention, a nightly sweep - reachable from exactly
 * one place: a three-dot overflow menu on the Projects page. Nothing in the
 * sidebar, nothing on the dashboard, nothing on mobile. Someone who deletes a
 * project by mistake has no path back to it that they could reasonably guess,
 * and the window closes on a timer they cannot see.
 */
const trashItem = { title: "Trash", url: "/projects/trash", icon: Trash2 } as const;
const helpItem = { title: "Help Center", url: "/help", icon: HelpCircle } as const;
// Covers bugs *and* feature suggestions now, so "Report issue" undersold it.
const reportIssueItem = { title: "Feedback", url: "/report-issue", icon: LifeBuoy } as const;

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
  const { signOut, user } = useAuth();
  const { profile } = useProfile();

  // Only the team owner (account owner who created the team) sees the
  // Teams tab and the Upgrade tab. Invited members are scoped to their work.
  const fetchTeam = getMyTeam;
  const { data: teamData } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
    enabled: !!user,
    staleTime: 60_000,
  });
  // Hide Teams/Upgrade only when we've confirmed the signed-in user is an
  // invited (non-owner) member of a team. Owners and solo users see both.
  const isInvitedMember =
    !!teamData && !!teamData.team && !!teamData.myRole && teamData.myRole !== "owner";
  const showOwnerNav = !isInvitedMember;
  // Templates: Pro/Team plans only. Visible to all team members on that plan
  // (they can apply templates); only owners/admins can create/edit (enforced on the page).
  const plan: string = (teamData?.plan as string | undefined) ?? "starter";
  const showTemplates = plan === "pro" || plan === "team";
  /*
   * Portfolio is a Team-tier feature, but it is *badged*, never removed.
   *
   * Dropping the row from the array is what produced "the Portfolio is still
   * not showing": a team on the Team plan whose `subscription_status` is
   * anything other than "active" (trialing, past_due, or simply never written)
   * got no nav row, no page, and no explanation - while Templates, which
   * checks `plan` alone, stayed visible right above it. Two gates of different
   * strictness reading as "half the app vanished".
   *
   * PortfolioPage already renders the upsell for a locked account, and this is
   * the rule that page states for its own tabs: "why can't I see Embeds?" is a
   * worse question than "why is this read-only?" - only one answers itself.
   * Nothing leaks by showing the row: the API and RLS gate on team membership.
   */
  const portfolioLocked = !(!!teamData?.isInternal || (!!teamData?.isActive && plan === "team"));
  const navItems: Array<{ title: string; url: string; icon: LucideIcon; locked?: boolean }> = [
    ...baseItems,
    ...(showTemplates ? [templatesItem] : []),
    { ...showcasesItem, locked: portfolioLocked },
    ...(showOwnerNav ? [teamItem] : [collabItem]),
  ];
  const toolItems = [
    ...(showOwnerNav ? [pricingItem] : []),
    trashItem,
    helpItem,
    reportIssueItem,
  ];

  /*
   * The badge is the only signal that anything is recoverable at all. Without a
   * number the row reads as an empty utility and gets ignored, which is the
   * state the product was already in.
   *
   * Deliberately not gated on plan or role: restoring your own deleted work is
   * not a premium feature, and `getTrashCounts` is already scoped to the caller.
   */
  const { data: trashCounts } = useQuery({
    queryKey: ["trash-counts"],
    queryFn: async () => (await getTrashCounts()) as { projects: number; photos: number },
    enabled: !!user,
    staleTime: 60_000,
  });
  const trashTotal = (trashCounts?.projects ?? 0) + (trashCounts?.photos ?? 0);

  const displayName = profile?.full_name || user?.email || "";
  const initials = getInitials(profile?.full_name, user?.email);

  const buttonBase = isMobile
    ? "flex items-center gap-3 h-14 px-3 rounded-xl text-base font-bold transition-colors"
    : "flex items-center gap-3 h-[52px] px-3 rounded-xl text-sm font-bold transition-colors";
  const iconBoxBase = isMobile
    ? "flex items-center justify-center h-9 w-9 rounded-lg shrink-0"
    : "flex items-center justify-center h-7 w-7 rounded-lg shrink-0";
  const iconBase = isMobile ? "h-5 w-5" : "h-4 w-4";

  const navButtonClass = (active: boolean) =>
    `${buttonBase} ${active ? "bg-sidebar-foreground text-sidebar shadow-lg" : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground/80"}`;
  const navIconBoxClass = (active: boolean) =>
    `${iconBoxBase} ${active ? "bg-sidebar-ring/10 text-sidebar-ring" : "bg-sidebar-foreground/10 text-sidebar-foreground/75"}`;

  return (
    <Sidebar collapsible="icon" className="border-r-0 bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="px-3 py-6">
        <Link to="/dashboard" className="flex items-center gap-2.5 px-1">
          <BrandLogo size={40} />
          {!collapsed && (
            <span className="text-lg font-extrabold leading-tight tracking-tight text-sidebar-foreground">
              Everbreeze SitePix
            </span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 gap-0">
        <SidebarGroup className="pt-5">
          <SidebarGroupContent>
            <SidebarMenu className={`${isMobile ? "gap-2" : "gap-1"}`}>
              {navItems.map((item) => {
                const active = pathname === item.url || pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} className={navButtonClass(active)}>
                      <Link to={item.url}>
                        <span className={navIconBoxClass(active)}>
                          <item.icon className={iconBase} />
                        </span>
                        {!collapsed && <span>{item.title}</span>}
                        {!collapsed && item.locked && (
                          // The name goes on a real text node, not as aria-label
                          // on the <svg> - lucide spreads props straight onto the
                          // element, and an aria-label there is only reliably
                          // announced with role="img". The link still reads as
                          // "Portfolio, Team plan"; the icon is decoration.
                          <span className="ml-auto flex shrink-0 items-center">
                            <Lock className="h-3.5 w-3.5 text-sidebar-foreground/40" aria-hidden />
                            <span className="sr-only">Team plan</span>
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-5 mt-2 border-t border-sidebar-border">
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-sidebar-foreground/40 mb-1">
              Workspace tools
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={`${isMobile ? "gap-2" : "gap-1"}`}>
              {toolItems.map((item) => {
                const active = pathname === item.url || pathname.startsWith(item.url + "/");
                const badge = item.url === trashItem.url && trashTotal > 0 ? trashTotal : 0;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} className={navButtonClass(active)}>
                      <Link to={item.url}>
                        <span className={`relative ${navIconBoxClass(active)}`}>
                          <item.icon className={iconBase} />
                          {/*
                            Collapsed to icons there is no room for a number, but
                            "something is in here" still has to survive - so the
                            count becomes a dot. Without this the badge simply
                            vanishes for anyone who works with the rail closed.
                          */}
                          {badge > 0 && collapsed && (
                            <span
                              aria-hidden
                              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar"
                            />
                          )}
                        </span>
                        {!collapsed && <span>{item.title}</span>}
                        {!collapsed && badge > 0 && (
                          <span className="ml-auto flex shrink-0 items-center">
                            <span className="rounded-full bg-sidebar-foreground/15 px-2 py-0.5 text-[11px] font-extrabold tabular-nums text-sidebar-foreground/80">
                              {badge > 99 ? "99+" : badge}
                            </span>
                          </span>
                        )}
                        {badge > 0 && (
                          // One text node carries the meaning for a screen
                          // reader in both states; the pill and the dot are
                          // decoration.
                          <span className="sr-only">
                            {badge} {badge === 1 ? "item" : "items"} in trash
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-2 pb-3 pt-2 border-t border-sidebar-border">
        {user && (
          <Link
            to="/settings"
            className={`flex items-center gap-3 rounded-xl px-3 hover:bg-sidebar-accent transition-colors ${isMobile ? "h-16" : "h-16"}`}
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex items-center justify-center h-8 w-8 rounded-full bg-sidebar-foreground/15 text-[10px] font-extrabold text-sidebar-foreground/65 shrink-0">
                {initials}
              </span>
            )}
            {!collapsed && (
              <>
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-bold text-sidebar-foreground/65 truncate">
                    {displayName}
                  </span>
                  <span className="text-[10px] font-medium text-sidebar-foreground/45">
                    Account &amp; settings
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-sidebar-foreground/65 shrink-0" />
              </>
            )}
          </Link>
        )}
        <Button
          variant="ghost"
          onClick={signOut}
          className={`justify-center w-full mt-1 ${isMobile ? "h-12 text-base" : "h-11 text-sm"} font-bold rounded-xl text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground/70`}
        >
          <LogOut className={isMobile ? "h-5 w-5" : "h-4 w-4"} />
          <span className="ml-2.5">Sign out</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
