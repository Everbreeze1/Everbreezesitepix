import { Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";
import { SUPPORT_EMAIL, mailtoHref } from "@/lib/contact";

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
      { label: "FAQ", to: "/faq" },
      { label: "Privacy policy", to: "/privacy-policy" },
      { label: "Terms of service", to: "/terms-of-service" },
    ],
  },
  {
    title: "Company",
    // Points at the /contact page rather than a bare mailto: - the address
    // itself is still a placeholder (see lib/contact.ts) and /help only exists
    // behind the app shell, so this is the one route every visitor can reach.
    links: [{ label: "Contact & support", to: "/contact" }],
  },
] as const;

export function SiteFooter() {
  const supportMailto = mailtoHref(SUPPORT_EMAIL);

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
              SitePix helps construction teams capture the truth of every job - then puts it where
              the whole team can use it.
            </p>
            {/* Was mailto:hello@sitepix.com - a domain that isn't ours. Until a
                real mailbox is confirmed the placeholder renders as inert text
                rather than a link that bounces. */}
            {supportMailto ? (
              <a
                href={supportMailto}
                className="font-manrope mt-6 inline-block text-sm font-bold text-sidebar-ring"
              >
                {SUPPORT_EMAIL}
              </a>
            ) : (
              <span className="font-manrope mt-6 inline-block text-sm font-bold text-sidebar-ring">
                {SUPPORT_EMAIL}
              </span>
            )}
          </div>

          {footerColumns.map((col) => (
            <div key={col.title}>
              <h3 className="font-manrope text-xs font-extrabold uppercase tracking-[1.68px] text-sidebar-foreground/45">
                {col.title}
              </h3>
              <ul className="mt-5 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="font-manrope text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 border-t border-sidebar-border pt-7">
          <p className="font-manrope text-xs text-sidebar-foreground/45">
            © {new Date().getFullYear()} Everbreeze SitePix. Built for the field.
          </p>
        </div>
      </div>
    </footer>
  );
}
