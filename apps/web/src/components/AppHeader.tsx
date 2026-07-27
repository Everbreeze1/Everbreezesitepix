import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Bell, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
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
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";

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
  const [query, setQuery] = useState("");
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
        <button
          type="button"
          onClick={() => toast.message("Notifications are coming soon.")}
          aria-label="Notifications"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card/70 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-2 py-1.5 shadow-sm"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[10px] font-extrabold text-background">
                {initials}
              </span>
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
