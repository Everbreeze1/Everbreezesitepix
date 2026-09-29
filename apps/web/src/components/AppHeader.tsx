import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, ChevronDown, CheckCheck, Moon, Plus, Search, Sun } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/BrandLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { useNotifications } from "@/hooks/use-notifications";
import { useTheme } from "@/hooks/use-theme";
import { formatRelativeTime } from "@/lib/format-time";
import { notificationLinkTarget } from "@/lib/notification-link";

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

export function AppHeader() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { guard } = useSubscriptionGate();
  const { unreadCount, recent, markRead, markAllRead } = useNotifications();
  const { theme, toggle: toggleTheme } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /* The theme is only known once localStorage has been read on the client, so the
     icon stays out of the server-rendered markup and appears on mount. */
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => setThemeReady(true), []);

  /* ⌘K / Ctrl+K jumps to search: the inline box from md up, or the search
     popover behind the icon button on narrower screens (where the box is
     display:none, so it has no offsetParent). */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const input = inputRef.current;
        if (input && input.offsetParent !== null) input.focus();
        else setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const displayName = profile?.full_name || user?.email || "";
  const initials = getInitials(profile?.full_name, user?.email);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    setSearchOpen(false);
    navigate({ to: "/projects", search: (q ? { q } : {}) as any });
  };

  const openNewProject = () =>
    guard(() => navigate({ to: "/projects/new" }), "Subscribe to create new projects.");

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 sm:px-5">
      <div className="flex items-center gap-2 md:hidden">
        <SidebarTrigger />
        <BrandLogo size={28} />
      </div>

      {/* From md up the sidebar is docked, so this folds it to the icon rail
          and back. Without it a tablet had no way to reclaim the width. */}
      <SidebarTrigger className="hidden md:inline-flex" />

      {/* Search box (md and up). Submitting lands on the Projects list filtered
          by the query; ⌘K / Ctrl+K focuses it. */}
      <form
        onSubmit={handleSearch}
        role="search"
        className="hidden h-8 max-w-[360px] flex-1 items-center gap-2 rounded-lg bg-secondary px-2.5 md:flex"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects, photos, reports…"
          aria-label="Search projects"
          className="w-full min-w-0 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground lg:inline-block">
          ⌘K
        </kbd>
      </form>

      {/* Right-aligned control cluster, styled to the Main-html topbar: 32px
          icon pills on a secondary fill, a divider, then the account chip. */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* Below md the search box collapses to an icon that opens it in a popover. */}
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Search"
              title="Search (⌘K)"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-foreground md:hidden"
            >
              <Search className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(320px,calc(100vw-32px))] p-2">
            <form onSubmit={handleSearch} role="search" className="flex items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects…"
                aria-label="Search projects"
                className="h-8 w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </form>
          </PopoverContent>
        </Popover>

        {/* Same flow as the Projects page button: the subscription gate, then
            /projects/new. Icon-only "+" at phone width. */}
        <button
          type="button"
          onClick={openNewProject}
          aria-label="New project"
          className="flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:px-3"
        >
          <Plus className="h-4 w-4" />
          <span className="max-sm:sr-only">New project</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={
            themeReady
              ? theme === "dark"
                ? "Switch to light"
                : "Switch to dark"
              : "Toggle light / dark"
          }
          title="Toggle light / dark"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-foreground"
        >
          {themeReady &&
            (theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
        </button>

        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Notifications"
              className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px] p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              <ScrollArea className="max-h-[400px]">
                <div className="divide-y divide-border">
                  {recent.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        void markRead(n.id);
                        setNotifOpen(false);
                        if (n.linkPath) navigate(notificationLinkTarget(n.linkPath) as any);
                      }}
                      className="flex w-full items-start gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
                    >
                      {!n.readAt && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                      <div className={`min-w-0 flex-1 ${n.readAt ? "pl-4" : ""}`}>
                        <p className="truncate font-medium text-foreground">{n.title}</p>
                        {n.body && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {n.body}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatRelativeTime(n.createdAt)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
            <div className="border-t border-border px-4 py-2.5 text-center">
              <Link
                to="/notifications"
                onClick={() => setNotifOpen(false)}
                className="text-xs font-medium text-primary hover:underline"
              >
                View all
              </Link>
            </div>
          </PopoverContent>
        </Popover>

        <div className="mx-1 h-6 w-px bg-border" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-secondary"
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-[26px] w-[26px] shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-foreground text-[10.5px] font-bold text-background">
                  {initials}
                </span>
              )}
              <span className="hidden text-[12.5px] font-semibold text-foreground sm:block">
                {profile?.full_name?.split(" ")[0] || displayName}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[230px]">
            <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">Account settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
