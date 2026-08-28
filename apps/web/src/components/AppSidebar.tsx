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
  ShieldCheck,
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
import { checkIsPlatformAdmin } from "@/lib/admin.functions";

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
// "Knowledge Base" rather than "Help Center": this row is an article library,
// and the path to a human is the separate Feedback row directly below it.
const helpItem = { title: "Knowledge Base", url: "/help", icon: HelpCircle } as const;
// Covers bugs *and* feature suggestions now, so "Report issue" undersold it.
const reportIssueItem = { title: "Feedback", url: "/report-issue", icon: LifeBuoy } as const;
/*
 * The admin dashboard had no link anywhere in the product. Five pages, a route
 * tree and a server-side gate all shipped, reachable only by typing /admin from
 * memory - so the console built to run the platform was, in practice, hidden
 * from the people who run it.
 *
 * Unlike the plan-gated rows above, this one is genuinely absent for
 * non-admins rather than badged. The badge convention exists so a customer can
 * see what their plan is missing and upgrade; platform admin is not a tier
 * anyone can buy, and advertising the console to every customer only invites
 * them to knock on a door that will not open.
 */
const adminItem = { title: "Admin", url: "/admin", icon: ShieldCheck } as const;

/**
 * The brand-blue rule down the left edge of the current row. Purely a marker:
 * the row's own tint and full-strength label are what carry "you are here" on
 * screen, and `isActive` on the button is what says it to a screen reader.
 */
function ActiveMarker() {
  return (
    <span
      aria-hidden
      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-ring"
    />
  );
}

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

  // Only the team owner (account owner who created the team) sees the Teams
  // tab, and only an owner is ever offered Upgrade - an invited member cannot
  // buy anything for a team that is not theirs. Owners are scoped further by
  // tier below.
  const fetchTeam = getMyTeam;
  const { data: teamData } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
    enabled: !!user,
    staleTime: 60_000,
  });
  // Only once we've confirmed the signed-in user is an invited (non-owner)
  // member of a team. Owners and solo users are not treated as members.
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
   * checks `plan` alone, stayed visible right above it. Two gates of different
   * strictness reading as "half the app vanished".
   *
   * PortfolioPage already renders the upsell for a locked account, and this is
   * the rule that page states for its own tabs: "why can't I see Embeds?" is a
   * worse question than "why is this read-only?" - only one answers itself.
   * Nothing leaks by showing the row: the API and RLS gate on team membership.
   */
  const portfolioLocked = !hasTeamAccess;
  const navItems: Array<{ title: string; url: string; icon: LucideIcon; locked?: boolean }> = [
    ...baseItems,
    ...(showTemplates ? [templatesItem] : []),
    { ...showcasesItem, locked: portfolioLocked },
    ...(showOwnerNav ? [teamItem] : [collabItem]),
  ];
  /*
   * Gated on the same server check the admin layout uses, so the row and the
   * page can never disagree. A non-admin who reaches /admin by hand still gets
   * the layout's "Admin access required" screen; hiding the row is a
   * convenience, never the security boundary - that lives in
   * requirePlatformAdmin() on every service.
   */
  const { data: adminCheck } = useQuery({
    queryKey: ["admin", "check"],
    queryFn: () => checkIsPlatformAdmin(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  /*
   * "Upgrade" is only a row while there is something left to upgrade to.
   *
   * Team is the top self-serve tier, so on it this crown sat in Workspace
   * tools advertising the plan the account already pays for: the one customer
   * who is not missing anything was the one being told they were. That is the
   * opposite of the plan-gated rows above, which stay visible and badged
   * precisely because they point at something the account could still get.
   *
   * Nothing is stranded by dropping it. The plan itself - invoices, seats,
   * what is included - lives in Settings > Billing, which the account row in
   * the footer opens. An inactive or lapsed account keeps the row whatever its
   * plan column says, because for them /pricing is the way back to a working
   * workspace.
   */
  const toolItems = [
    ...(showOwnerNav && !hasTeamAccess ? [pricingItem] : []),
    trashItem,
    helpItem,
    reportIssueItem,
    ...(adminCheck?.isAdmin ? [adminItem] : []),
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

  /*
   * Every row used to carry its icon inside a filled rounded box, so a rail of
   * a dozen entries read as a dozen grey tiles stacked on the navy, and the
   * current row was a white slab with a drop shadow - a raised button floating
   * on the flat surface it is part of.
   *
   * The chips are gone, because an icon on a rail does not need a container to
   * be legible. That, plus the shorter rows, is also what buys back the height
   * the list was overflowing by: at a 900px window the nav needed 765px in a
   * 671px box, so the last rows were sliced in half by the footer and a
   * scrollbar ran down the navy.
   *
   * The current row is a quiet tint with the brand blue as a rule down its
   * left edge. Deliberately not a solid blue pill: white on #2584f4 is 3.7:1,
   * under AA at this size, while white on the tint clears 12:1 and the blue
   * does its work as an accent instead of as a background.
   */
  const buttonBase = isMobile
    ? "relative flex items-center gap-3 h-[52px] px-3 rounded-lg text-[15px] font-semibold transition-colors"
    : "relative flex items-center gap-3 h-(--rail-row) px-3 rounded-lg text-sm font-semibold transition-colors";
  const iconBase = isMobile ? "h-5 w-5" : "h-[18px] w-[18px]";

  const navButtonClass = (active: boolean) =>
    `${buttonBase} ${
      active
        ? "bg-sidebar-accent text-sidebar-foreground"
        : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
    }`;
  const navIconClass = (active: boolean) =>
    `${iconBase} ${active ? "text-sidebar-foreground" : "text-sidebar-foreground/45"}`;

  return (
    <Sidebar collapsible="icon" className="border-r-0 bg-sidebar text-sidebar-foreground">
      <SidebarHeader className="px-3 py-4 [@media(max-height:719px)]:py-2">
        <Link to="/dashboard" className="flex items-center gap-2.5 px-1">
          {/* The collapsed rail is 48px wide and this Link is inset 16px, so a
              36px mark hung 5px out over the page beside it. */}
          <BrandLogo size={collapsed ? 28 : 36} />
          {!collapsed && (
            <span className="text-[17px] font-bold leading-tight tracking-tight text-sidebar-foreground">
              Everlumen
            </span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent className="scroll-slim px-2 gap-0">
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            <SidebarMenu className={`${isMobile ? "gap-1.5" : "gap-(--rail-gap)"}`}>
              {navItems.map((item) => {
                const active = pathname === item.url || pathname.startsWith(item.url + "/");
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} className={navButtonClass(active)}>
                      <Link to={item.url}>
                        {active && !collapsed && <ActiveMarker />}
                        {/*
                          The icon keeps a wrapper even with the chip gone:
                          SidebarMenuButton's own variant carries
                          `[&>svg]:size-4`, which outranks a class set on the
                          svg itself and would pin every icon to 16px, mobile
                          included.
                        */}
                        <span className="flex shrink-0 items-center">
                          <item.icon className={navIconClass(active)} />
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

        <SidebarGroup className="mt-2 border-t border-sidebar-border pt-3">
          {!collapsed && (
            <SidebarGroupLabel className="mb-1 text-[10px] font-bold uppercase tracking-[1.2px] text-sidebar-foreground/35">
              Workspace tools
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={`${isMobile ? "gap-1.5" : "gap-(--rail-gap)"}`}>
              {toolItems.map((item) => {
                const active = pathname === item.url || pathname.startsWith(item.url + "/");
                const badge = item.url === trashItem.url && trashTotal > 0 ? trashTotal : 0;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} className={navButtonClass(active)}>
                      <Link to={item.url}>
                        {active && !collapsed && <ActiveMarker />}
                        <span className="relative flex shrink-0 items-center">
                          <item.icon className={navIconClass(active)} />
                          {/*
                            Collapsed to icons there is no room for a number, but
                            "something is in here" still has to survive - so the
                            count becomes a dot. Without this the badge simply
                            vanishes for anyone who works with the rail closed.
                          */}
                          {badge > 0 && collapsed && (
                            <span
                              aria-hidden
                              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sidebar-ring ring-2 ring-sidebar"
                            />
                          )}
                        </span>
                        {!collapsed && <span>{item.title}</span>}
                        {!collapsed && badge > 0 && (
                          <span className="ml-auto flex shrink-0 items-center">
                            <span className="rounded-full bg-sidebar-foreground/12 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-sidebar-foreground/70">
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
      <SidebarFooter className="border-t border-sidebar-border px-2 pb-2 pt-1">
        {user && (
          <Link
            to="/settings"
            className={`flex items-center gap-3 rounded-lg px-3 transition-colors hover:bg-sidebar-accent ${isMobile ? "h-16" : "h-14"}`}
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
                  <span className="truncate text-sm font-semibold text-sidebar-foreground/85">
                    {displayName}
                  </span>
                  <span className="text-[11px] font-medium text-sidebar-foreground/45">
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
          aria-label="Sign out"
          title="Sign out"
          className={`mt-1 w-full justify-center ${isMobile ? "h-12 text-base" : "h-9 text-sm [@media(max-height:719px)]:h-8"} rounded-lg font-semibold text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground/80`}
        >
          <LogOut className={isMobile ? "h-5 w-5" : "h-4 w-4"} />
          {/* Collapsed to icons the label had nowhere to go and ran out past
              the rail. The accessible name moves onto the button so the
              icon-only state is still announced, and the tooltip says it to
              everyone else. */}
          {!collapsed && <span className="ml-2.5">Sign out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
