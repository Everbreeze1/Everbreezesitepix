import { Link, useRouterState } from "@tanstack/react-router";
import { FolderKanban, Images, User, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Map", url: "/map", icon: MapIcon },
  { title: "Gallery", url: "/gallery", icon: Images },
  { title: "Account", url: "/settings", icon: User },
] as const;

export function MobileTabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((t) => {
          const active = pathname === t.url || pathname.startsWith(t.url + "/");
          const prominent = "prominent" in t && t.prominent;
          return (
            <li key={t.url}>
              <Link
                to={t.url}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {prominent ? (
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full -mt-3 shadow-lg ring-4 ring-background",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary/90 text-primary-foreground",
                    )}
                  >
                    <t.icon className="h-5 w-5" />
                  </span>
                ) : (
                  <t.icon className={cn("h-5 w-5", active && "scale-110")} />
                )}
                <span className="leading-none">{t.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
