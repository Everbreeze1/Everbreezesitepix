import { Link, useRouterState } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { BrandLogo } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Home", url: "/" },
  { label: "Features", url: "/features" },
  { label: "How it works", url: "/how-it-works" },
  { label: "Pricing", url: "/pricing" },
  { label: "FAQ", url: "/faq" },
] as const;

interface SiteHeaderProps {
  /** Floats transparent over a dark hero until the user scrolls, then becomes the white pill. */
  transparent?: boolean;
}

export function SiteHeader({ transparent = false }: SiteHeaderProps) {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mounted, setMounted] = useState(false);
  const [scrolled, setScrolled] = useState(!transparent);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!transparent) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [transparent]);

  const navLinkClass = (active: boolean) =>
    cn(
      "font-manrope relative rounded-lg px-3 py-2 text-sm font-bold transition-colors",
      scrolled
        ? cn(
            "text-muted-foreground hover:bg-accent hover:text-foreground",
            active && "text-foreground",
          )
        : cn("text-white/85 hover:bg-white/10 hover:text-white", active && "text-white"),
    );

  const underline = (
    <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-primary" />
  );

  return (
    <header
      className="sticky top-0 z-40 w-full px-4 transition-[padding] duration-300 ease-out sm:px-6"
      style={{ paddingTop: scrolled ? 16 : 0 }}
    >
      <div
        className={cn(
          "mx-auto flex h-[70px] max-w-[1280px] items-center justify-between px-6 transition-all duration-300 ease-out",
          scrolled
            ? "rounded-full border border-border bg-card/95 shadow-sm"
            : "rounded-none border border-transparent bg-transparent shadow-none",
        )}
      >
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <BrandLogo size={40} />
          <span
            className={cn(
              "font-manrope text-lg font-extrabold tracking-[-0.45px] transition-colors",
              scrolled ? "text-foreground" : "text-white",
            )}
          >
            Ever<span className="text-primary">lumen</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => {
            const active = pathname === link.url;
            return (
              <Link key={link.label} to={link.url} className={navLinkClass(active)}>
                {link.label}
                {active && underline}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-full transition-colors",
              scrolled
                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                : "text-white/85 hover:bg-white/10 hover:text-white",
            )}
            onClick={toggle}
            aria-label={
              mounted
                ? theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
                : "Toggle theme"
            }
          >
            {mounted &&
              (theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />)}
          </Button>
          {user ? (
            <Button
              asChild
              size="sm"
              className="font-manrope rounded-full bg-primary px-5 font-bold text-primary-foreground shadow-none hover:bg-primary/90"
            >
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Link
                to="/login"
                className={cn(
                  "font-manrope hidden rounded-lg px-3 py-2 text-sm font-bold transition-colors sm:inline-flex",
                  scrolled ? "text-foreground hover:bg-accent" : "text-white hover:bg-white/10",
                )}
              >
                Log in
              </Link>
              <Button
                asChild
                size="sm"
                className="font-manrope rounded-full bg-primary px-5 font-bold text-primary-foreground shadow-none hover:bg-primary/90"
              >
                <Link to="/signup">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
