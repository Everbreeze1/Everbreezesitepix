import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";
import { SiteFooter } from "@/components/SiteFooter";
import { PRIVACY_EMAIL, SUPPORT_EMAIL, isPlaceholder, mailtoHref } from "@/lib/contact";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact & Support - Everbreeze SitePix" },
      {
        name: "description",
        content:
          "Get in touch with the Everbreeze SitePix team - support for job site photo capture, reports, billing questions, and privacy requests.",
      },
      { property: "og:title", content: "Contact & Support - Everbreeze SitePix" },
      {
        property: "og:description",
        content:
          "Get in touch with the Everbreeze SitePix team - support for job site photo capture, reports, billing questions, and privacy requests.",
      },
      { property: "og:url", content: "https://www.everbreezesitepix.com/contact" },
    ],
    links: [{ rel: "canonical", href: "https://www.everbreezesitepix.com/contact" }],
  }),
  component: ContactPage,
});

/**
 * An address is rendered as a live `mailto:` only once the owner has replaced
 * the placeholder in lib/contact.ts - an unresolved one shows as plain text so
 * we never publish a link that bounces.
 */
function EmailLine({ label, email, subject }: { label: string; email: string; subject?: string }) {
  const href = mailtoHref(email, subject);
  return (
    <p className="text-muted-foreground">
      {label}:{" "}
      {href ? (
        <a href={href} className="text-primary hover:underline">
          {email}
        </a>
      ) : (
        <span className="text-foreground">{email}</span>
      )}
    </p>
  );
}

function ContactPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="h-14 flex items-center border-b border-border bg-background/95 backdrop-blur px-4 sticky top-0 z-20">
        <Link to="/" className="flex items-center gap-2">
          <BrandLogo size={28} />
          <span className="text-sm font-bold tracking-tight">
            Everbreeze <span className="text-primary">SitePix</span>
          </span>
        </Link>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-10 md:py-16">
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Contact &amp; Support
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Real people, one inbox. We aim to reply within one business day.
          </p>
        </div>

        <div className="space-y-10 text-sm leading-7 text-foreground">
          {isPlaceholder(SUPPORT_EMAIL) && (
            // Loud on purpose: this page is worthless until a real mailbox is
            // wired up, and a silent placeholder would ship unnoticed.
            <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="font-medium text-foreground">Support address not configured</p>
              <p className="text-muted-foreground">
                The contact addresses on this page are still placeholders. Set them in{" "}
                <code className="font-mono text-xs">apps/web/src/lib/contact.ts</code> before
                launch.
              </p>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Support</h2>
            <p className="text-muted-foreground">
              Something not working, a question about a feature, or trouble with an upload? Email us
              and include your account email plus the project or report you were on - it gets you an
              answer far faster.
            </p>
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-4">
              <p className="font-medium text-foreground">Everbreeze SitePix Support</p>
              <EmailLine label="Email" email={SUPPORT_EMAIL} subject="SitePix support" />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Already signed in?</h2>
            <p className="text-muted-foreground">
              The in-app Help Center has step-by-step guides for photo capture, checklists,
              workflows, walkthroughs, reports and team management - most questions are answered
              there without waiting for a reply. You can also report a bug straight from the app,
              which sends us the context we need automatically.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link
                to="/help"
                className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Open the Help Center
              </Link>
              <Link
                to="/report-issue"
                className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Report an issue
              </Link>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              Billing and subscriptions
            </h2>
            <p className="text-muted-foreground">
              Plan changes, seat counts, invoices and cancellation are all self-serve from the
              Settings page inside the app. For anything the billing portal cannot do - a refund
              question, a failed payment, or a plan that does not fit - email support and mention
              your team name.
            </p>
            <p className="text-muted-foreground mt-2">
              Plans and prices are listed on the{" "}
              <Link to="/pricing" className="text-primary hover:underline">
                Pricing
              </Link>{" "}
              page, and the billing terms are in our{" "}
              <Link to="/terms-of-service" className="text-primary hover:underline">
                Terms of Service
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              Privacy and data requests
            </h2>
            <p className="text-muted-foreground">
              To request access to, correction of, or deletion of your personal data - or to ask how
              your photos are processed - use the privacy inbox. We respond within 30 days as
              described in our{" "}
              <Link to="/privacy-policy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-4">
              <EmailLine label="Email" email={PRIVACY_EMAIL} subject="Privacy request" />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Security</h2>
            <p className="text-muted-foreground">
              If you believe you have found a vulnerability, please report it privately to the
              support address above with &quot;Security&quot; in the subject line, and give us a
              reasonable window to fix it before disclosing it publicly. Please do not test against
              other customers&apos; data.
            </p>
          </section>
        </div>

        <div className="mt-12 text-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Home
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
