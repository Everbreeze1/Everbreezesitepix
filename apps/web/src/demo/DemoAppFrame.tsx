import {
  Bell,
  ChevronDown,
  Crown,
  FileText,
  FolderKanban,
  HelpCircle,
  Images,
  LayoutDashboard,
  Layers,
  LifeBuoy,
  Map as MapIcon,
  Plus,
  Search,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { demoCrew } from "@/demo/fixtures";
import { cn } from "@/lib/utils";

export type DemoNavId = "overview" | "projects" | "project" | "map" | "gallery" | "reports";

interface DemoNavItem {
  id: DemoNavId;
  label: string;
  icon: LucideIcon;
}

/** The screens this tour can actually show. */
const primaryNav: DemoNavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "map", label: "Maps", icon: MapIcon },
  { id: "gallery", label: "Gallery", icon: Images },
  { id: "reports", label: "Reports", icon: FileText },
];

/**
 * Real sidebar destinations that the tour does not deep-dive. Kept in the nav
 * so the shell looks like the product instead of an amputated sidebar; clearly
 * dimmed rather than clickable so nobody mistakes a dead link for a bug.
 */
const auxiliaryNav: Array<{ label: string; icon: LucideIcon }> = [
  { label: "Teams", icon: Users },
  { label: "Portfolio", icon: Layers },
  { label: "Trash", icon: Trash2 },
  { label: "Knowledge Base", icon: HelpCircle },
  { label: "Feedback", icon: LifeBuoy },
];

interface DemoAppFrameProps {
  active: DemoNavId;
  onSelect: (id: DemoNavId) => void;
  children: React.ReactNode;
}

export function DemoAppFrame({ active, onSelect, children }: DemoAppFrameProps) {
  const activeItem = active === "project" ? "projects" : active;
  const owner = demoCrew[0];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="flex h-[560px] sm:h-[660px]">
        {/* Sidebar - desktop only, mirroring AppSidebar */}
        <aside className="hidden w-[244px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <div className="flex h-[58px] items-center gap-2.5 px-4">
            <BrandLogo size={30} />
            <span className="font-manrope text-sm font-extrabold tracking-[-0.3px] text-sidebar-foreground">
              Ever<span className="text-brand-gold">lumen</span>
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 pt-1">
            <SidebarGroup>
              {primaryNav.map((item) => (
                <SidebarRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={activeItem === item.id}
                  onClick={() => onSelect(item.id)}
                />
              ))}
            </SidebarGroup>
            <SidebarGroup title="Workspace">
              {auxiliaryNav.map((item) => (
                <SidebarRow
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  muted
                  title="Part of the full Everlumen app"
                />
              ))}
            </SidebarGroup>
          </div>

          <div className="border-t border-sidebar-border p-3">
            <div className="flex items-center justify-between rounded-lg bg-sidebar-accent/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <Crown className="h-3.5 w-3.5 text-brand-gold" />
                <span className="font-manrope text-xs font-bold text-sidebar-foreground">
                  Team plan
                </span>
              </div>
              <span className="rounded-full bg-brand-gold/15 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-brand-gold">
                Sample data
              </span>
            </div>
          </div>
        </aside>
        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          {/* Top bar */}
          <div className="flex h-[58px] shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-4">
            <div className="flex items-center gap-2 lg:hidden">
              <BrandLogo size={26} />
              <span className="font-manrope text-sm font-extrabold text-foreground">
                Ever<span className="text-brand-gold">lumen</span>
              </span>
            </div>

            <div className="hidden max-w-[340px] flex-1 items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 md:flex">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search (demo)"
                placeholder="Search projects, photos, people…"
                className="w-full bg-transparent font-manrope text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative" title="Notifications (part of the full app)">
                <button
                  type="button"
                  aria-label="Notifications"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/70 text-muted-foreground"
                >
                  <Bell className="h-4 w-4" />
                </button>
                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
              </div>

              <button
                type="button"
                aria-label="Account menu"
                className="flex items-center gap-2 rounded-lg border border-border bg-card/70 px-2 py-1.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[10px] font-extrabold text-background">
                  {owner.initials}
                </span>
                <span className="font-manrope hidden text-xs font-bold text-foreground sm:block">
                  {owner.name.split(" ")[0]}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              <button
                type="button"
                className="font-manrope hidden items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground sm:inline-flex"
                title="New project (part of the full app)"
              >
                <Plus className="h-3.5 w-3.5" /> New project
              </button>
            </div>
          </div>

          {/* Screen content */}
          <div className="relative flex-1 overflow-y-auto">{children}</div>

          {/* Mobile tab bar */}
          <div className="flex shrink-0 items-center justify-around border-t border-border bg-card/95 px-2 py-1.5 lg:hidden">
            {primaryNav.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 font-manrope text-[10px] font-bold",
                  activeItem === item.id ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarGroup({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className={cn(!title && "mt-1")}>
      {title && (
        <p className="font-manrope px-3 pb-1 pt-4 text-[10px] font-extrabold uppercase tracking-[1.6px] text-sidebar-foreground/40">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function SidebarRow({
  icon: Icon,
  label,
  active,
  muted,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  muted?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "font-manrope relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors",
        active
          ? "bg-accent text-sidebar-primary"
          : muted
            ? "cursor-default text-sidebar-foreground/35"
            : "cursor-pointer text-sidebar-foreground/80 hover:bg-accent/50 hover:text-sidebar-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-sidebar-ring"
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && (
        <span className="text-[9px] font-extrabold uppercase tracking-wide text-muted-foreground">
          Demo
        </span>
      )}
    </div>
  );
}
