import { Link } from "@tanstack/react-router";
import { Instagram, Youtube, Linkedin } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const footerColumns = [
  {
    title: "Platform",
    links: [
      { label: "Features", to: "/features" },
      { label: "How it works", to: "/how-it-works" },
      { label: "Pricing", to: "/pricing" },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "Resources", href: "#" },
      { label: "Help center", href: "#" },
      { label: "FAQ", to: "/faq" },
      { label: "Security", href: "#" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Our story", href: "#" },
      { label: "Customers", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
] as const;

const socialLinks = [
  { label: "Instagram", href: "#", icon: Instagram },
  { label: "YouTube", href: "#", icon: Youtube },
  { label: "LinkedIn", href: "#", icon: Linkedin },
];

export function SiteFooter() {
  return (
    <footer className="bg-sidebar">
      <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-8 md:py-20">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[357px_1fr_1fr_1fr] lg:gap-8">
          <div>
            <Link to="/" className="flex items-center gap-2.5">
              <BrandLogo size={40} />
              <span className="font-manrope text-lg font-extrabold tracking-[-0.45px] text-sidebar-foreground">
                Everbreeze <span className="text-sidebar-ring">SitePix</span>
              </span>
            </Link>
            <p className="font-manrope mt-5 max-w-[358px] text-sm leading-6 text-sidebar-foreground/60">
              SitePix helps construction teams capture the truth of every job — then puts it where
              the whole team can use it.
            </p>
            <a
              href="mailto:hello@sitepix.com"
              className="font-manrope mt-6 inline-block text-sm font-bold text-sidebar-ring"
            >
              hello@sitepix.com
            </a>
          </div>

          {footerColumns.map((col) => (
            <div key={col.title}>
              <h3 className="font-manrope text-xs font-extrabold uppercase tracking-[1.68px] text-sidebar-foreground/45">
                {col.title}
              </h3>
              <ul className="mt-5 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {"to" in link ? (
                      <Link
                        to={link.to}
                        className="font-manrope text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        className="font-manrope text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center gap-4 border-t border-sidebar-border pt-7 sm:flex-row sm:justify-between">
          <p className="font-manrope text-xs text-sidebar-foreground/45">
            © {new Date().getFullYear()} Everbreeze SitePix. Built for the field.
          </p>
          <div className="flex items-center gap-4">
            {socialLinks.map((s) => (
              <a
                key={s.label}
                href={s.href}
                aria-label={s.label}
                className="text-sidebar-foreground/55 hover:text-sidebar-foreground"
              >
                <s.icon className="h-5 w-5" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
