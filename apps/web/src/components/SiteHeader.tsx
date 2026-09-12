import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { BrandLogo } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navLinks = [
  { label: "Home", url: "/" },
  { label: "Features", url: "/features" },
  { label: "How it works", url: "/how-it-works" },
  { label: "Pricing", url: "/pricing" },
  { label: "FAQ", url: "/faq" },
] as const;

interface SiteHeaderProps {
  /** Kept for call-site compatibility; the landing nav is now always solid navy. */
  transparent?: boolean;
}

export function SiteHeader(_props: SiteHeaderProps) {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const navLinkClass = (active: boolean) =>
    cn(
      "font-manrope relative py-2 text-sm font-semibold transition-colors",
      active
        ? "text-sidebar-foreground"
        : "text-sidebar-foreground/70 hover:text-sidebar-foreground",
    );

  const underline = (
    <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-primary" />
  );

  return (
    <header className="sticky top-0 z-40 w-full border-b border-sidebar-border bg-sidebar">
      <div className="mx-auto flex h-[70px] max-w-[1280px] items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <BrandLogo size={32} />
          <span className="font-manrope text-[17px] font-bold tracking-[-0.01em] text-sidebar-foreground">
            Ever
            <span className="text-brand-gold">lumen</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-[30px] md:flex">
          {navLinks.map((link) => {
            const active = pathname === link.url;
            return (
              <Link key={link.label} to={link.url} className={navLinkClass(active)}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
          {/* Mobile menu - visible below md where the inline nav is hidden */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                className="flex h-9 w-9 items-center justify-center rounded-full text-sidebar-foreground transition-colors hover:bg-sidebar-accent md:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] sm:w-[320px]">
              <SheetHeader>
                <SheetTitle className="font-manrope text-left">Menu</SheetTitle>
                <SheetDescription className="sr-only">
                  Site navigation and account actions
                </SheetDescription>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-1">
                {navLinks.map((link) => {
                  const active = pathname === link.url;
                  return (
                    <Link
                      key={link.label}
                      to={link.url}
                      className={cn(
                        "font-manrope rounded-lg px-3 py-2.5 text-sm font-bold transition-colors",
                        active
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
              <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6">
                <Link
                  to="/demo"
                  className="font-manrope flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-accent"
                >
                  Demo
                </Link>
                {user ? (
                  <Link
                    to="/dashboard"
                    className="font-manrope flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Dashboard
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="font-manrope flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-accent"
                    >
                      Log in
                    </Link>
                    <Link
                      to="/signup"
                      className="font-manrope flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      Sign up
                    </Link>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {user ? (
            <Button
              asChild
              size="sm"
              className="font-manrope hidden rounded-full bg-primary px-5 font-bold text-primary-foreground shadow-none hover:bg-primary/90 md:inline-flex"
            >
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Link
                to="/demo"
                className="font-manrope hidden rounded-full border border-sidebar-border px-5 py-2 text-sm font-bold text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground sm:inline-flex md:inline-flex"
              >
                Demo
              </Link>
              <Link
                to="/login"
                className="font-manrope hidden rounded-lg px-3 py-2 text-sm font-bold text-sidebar-foreground/80 transition-colors hover:text-sidebar-foreground sm:inline-flex md:inline-flex"
              >
                Log in
              </Link>
              <Button
                asChild
                size="sm"
                className="font-manrope hidden rounded-full bg-primary px-5 font-bold text-primary-foreground shadow-none hover:bg-primary/90 md:inline-flex"
              >
                <Link to="/signup">Start free trial</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
