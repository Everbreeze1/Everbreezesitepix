import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Bell, ChevronDown, Plus, CheckCheck } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
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
import { formatRelativeTime } from "@/lib/format-time";

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
  const [query, setQuery] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
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
    navigate({ to: "/projects", search: (q ? { q } : {}) as any });
  };

  return (
    <header className="sticky top-0 z-20 flex h-[82px] shrink-0 items-center justify-between gap-4 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-10">
      <div className="flex items-center gap-2 md:hidden">
        <SidebarTrigger />
        <BrandLogo size={28} />
      </div>

      <form
        onSubmit={handleSearch}
        className="hidden max-w-[421px] flex-1 items-center gap-3 rounded-xl border border-border bg-card/70 px-3 py-2.5 shadow-sm md:flex"
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects, photos, reports…"
          className="font-manrope w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <kbd className="font-manrope hidden shrink-0 rounded-md bg-muted px-1.5 py-1 text-[10px] font-bold text-muted-foreground lg:inline-block">
          ⌘K
        </kbd>
      </form>

      <div className="flex items-center gap-3">
        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card/70 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
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
                        if (n.linkPath) navigate({ to: n.linkPath });
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-2 py-1.5 shadow-sm"
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-extrabold text-background">
                  {initials}
                </span>
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">Account &amp; settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          onClick={() =>
            guard(
              () => navigate({ to: "/projects/new" }),
              "Subscribe to create new projects.",
            )
          }
          className="font-manrope hidden rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90 sm:inline-flex"
        >
          <Plus className="h-4 w-4" /> New project
        </Button>
      </div>
    </header>
  );
}
