import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, ChevronDown, CheckCheck, Moon, Sun } from "lucide-react";
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
  const { unreadCount, recent, markRead, markAllRead } = useNotifications();
  const { theme, toggle: toggleTheme } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  /* The theme is only known once localStorage has been read on the client, so the
     icon stays out of the server-rendered markup and appears on mount. */
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => setThemeReady(true), []);

  const displayName = profile?.full_name || user?.email || "";
  const initials = getInitials(profile?.full_name, user?.email);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 sm:px-5">
      <div className="flex items-center gap-2 md:hidden">
        <SidebarTrigger />
        <BrandLogo size={28} />
      </div>

      {/* Right-aligned control cluster, styled to the Main-html topbar: 32px
          icon pills on a secondary fill, a divider, then the account chip. */}
      <div className="ml-auto flex items-center gap-1.5">
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
          {themeReady && (theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
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
              className="flex items-center gap-2 rounded-lg py-[5px] pl-[5px] pr-2 transition-colors hover:bg-secondary"
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