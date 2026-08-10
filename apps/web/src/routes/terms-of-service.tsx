import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";
import { SiteFooter } from "@/components/SiteFooter";
import {
  GOVERNING_LAW,
  LEGAL_EMAIL,
  LEGAL_ENTITY,
  REGISTERED_ADDRESS,
  SUPPORT_EMAIL,
  TERMS_EFFECTIVE_DATE,
  mailtoHref,
} from "@/lib/contact";

export const Route = createFileRoute("/terms-of-service")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Everbreeze SitePix" },
      {
        name: "description",
        content:
          "Terms of Service for Everbreeze SitePix. The agreement covering your subscription, your job site photos and reports, acceptable use, AI-generated output, and public share links.",
      },
      { property: "og:title", content: "Terms of Service — Everbreeze SitePix" },
      {
        property: "og:description",
        content:
          "Terms of Service for Everbreeze SitePix. The agreement covering your subscription, your job site photos and reports, acceptable use, AI-generated output, and public share links.",
      },
      { property: "og:url", content: "https://www.everbreezesitepix.com/terms-of-service" },
    ],
    links: [{ rel: "canonical", href: "https://www.everbreezesitepix.com/terms-of-service" }],
  }),
  component: TermsOfServicePage,
});

/*
 * TEMPLATE — NOT LEGAL ADVICE. This page was drafted to describe what the
 * product actually does; it has NOT been reviewed by a lawyer. Every `[[...]]`
 * placeholder must be filled in and the whole document reviewed by counsel
 * qualified in the governing jurisdiction before launch.
 */
function TermsOfServicePage() {
  // Placeholder until the owner confirms the date these terms take effect.
  const effectiveDate = TERMS_EFFECTIVE_DATE;
  const legalMailto = mailtoHref(LEGAL_EMAIL);
  const supportMailto = mailtoHref(SUPPORT_EMAIL);

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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective: {effectiveDate}</p>
        </div>

        <div className="space-y-10 text-sm leading-7 text-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground">
              These Terms of Service (the &quot;Terms&quot;) are a binding agreement between{" "}
              {LEGAL_ENTITY} (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;), operator of
              Everbreeze SitePix, and the business or individual that creates an account
              (&quot;you&quot;). By creating an account, subscribing, or otherwise using the
              Services you accept these Terms and our{" "}
              <Link to="/privacy-policy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              . If you do not accept them, do not use the Services.
            </p>
            <p className="text-muted-foreground mt-2">
              If you accept these Terms on behalf of a company, you confirm that you have authority
              to bind that company, and &quot;you&quot; means that company.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              2. Description of the Service
            </h2>
            <p className="text-muted-foreground">
              Everbreeze SitePix is a subscription software service for construction and field
              trades. It lets you capture and organise job site photos, videos and walkthrough
              recordings; run checklists and workflows; generate site logs and reports (including
              AI-assisted ones); publish public share links and portfolio pages; and collaborate
              with team members you invite. The Services are provided as a web and mobile
              application together with the everbreezesitepix.com website.
            </p>
            <p className="text-muted-foreground mt-2">
              We may add, change or remove features. Where a change materially reduces functionality
              you are paying for, we will give you reasonable notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              3. Accounts, Eligibility and Team Access
            </h2>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-muted-foreground">
              <li>
                You must be at least 18 years old and legally able to enter into contracts. The
                Services are intended for business use, not for consumers.
              </li>
              <li>
                You are responsible for the accuracy of your account details, for keeping your
                credentials confidential, and for all activity that happens under your account.
              </li>
              <li>
                Account owners may invite team members and assign roles. The account owner is
                responsible for everything their team members do in the workspace, including what
                they upload and what they share publicly.
              </li>
              <li>
                Notify us promptly at{" "}
                {supportMailto ? (
                  <a href={supportMailto} className="text-primary hover:underline">
                    {SUPPORT_EMAIL}
                  </a>
                ) : (
                  <span className="text-foreground">{SUPPORT_EMAIL}</span>
                )}{" "}
                if you believe your account has been accessed without authorisation.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              4. Subscriptions, Billing and Refunds
            </h2>
            <div className="space-y-3 text-muted-foreground">
              <p>
                The Services are sold as paid subscriptions. Current tiers are{" "}
                <strong className="text-foreground">Starter</strong>,{" "}
                <strong className="text-foreground">Pro</strong> and{" "}
                <strong className="text-foreground">Team</strong>; the prices, included seats, seat
                limits and per-seat rates in force are the ones shown on our{" "}
                <Link to="/pricing" className="text-primary hover:underline">
                  Pricing
                </Link>{" "}
                page at the time you subscribe.
              </p>
              <p>
                Subscriptions may be billed monthly or annually and renew automatically for the same
                period until cancelled. Payments are processed by Stripe; by subscribing you
                authorise us and Stripe to charge your payment method for the plan and seat count
                you have selected, plus any applicable taxes. We do not store your full card
                details.
              </p>
              <p>
                Adding seats increases your charge; we may bill added seats immediately or on your
                next invoice. Removing seats takes effect at the next renewal unless we state
                otherwise.
              </p>
              <p>
                You can cancel at any time from Settings. Cancellation stops future renewals and
                takes effect at the end of the period you have already paid for — you keep access
                until then.
              </p>
              <p>
                <strong className="text-foreground">Refunds.</strong> Except where a refund is
                required by law, fees already paid are non-refundable and we do not refund partial
                periods or unused seats. We may, at our discretion, issue a refund or credit — for
                example after a prolonged outage.
              </p>
              <p>
                If a payment fails we may retry it, notify you, and suspend or downgrade your
                workspace if it remains unpaid. We may change prices with at least 30 days&apos;
                notice before the change applies to your next renewal.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Acceptable Use</h2>
            <p className="text-muted-foreground">You agree not to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-muted-foreground">
              <li>
                Upload or share content you do not have the right to upload or share, or that
                infringes anyone&apos;s intellectual property, privacy or other rights.
              </li>
              <li>
                Upload unlawful, defamatory, harassing, or deliberately misleading content, or
                content depicting people in a way that would breach their privacy rights.
              </li>
              <li>
                Attempt to access another customer&apos;s workspace, projects, photos, share links
                or invite tokens; probe, scan or test the security of the Services; or circumvent
                plan limits, seat caps or access controls.
              </li>
              <li>
                Scrape, resell, sublicense or mirror the Services, or use them to build a competing
                product.
              </li>
              <li>
                Use the Services to send unsolicited email, distribute malware, or place unusual
                load on our infrastructure through automated requests.
              </li>
              <li>
                Use AI features to generate content that is unlawful, or present AI output as an
                independent professional opinion (see section 9).
              </li>
            </ul>
            <p className="text-muted-foreground mt-3">
              We may investigate suspected breaches and may suspend or terminate accounts, disable
              share links, or remove content that we reasonably believe breaches these Terms or
              exposes us or other customers to risk.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              6. Your Content and the Licence You Grant Us
            </h2>
            <p className="text-muted-foreground">
              <strong className="text-foreground">You own your content.</strong> Photos, videos,
              walkthrough recordings, captions, notes, checklists, reports, project data and
              anything else you upload or create in the Services (&quot;Your Content&quot;) remain
              yours. We claim no ownership of it.
            </p>
            <p className="text-muted-foreground mt-2">
              To actually run the product, we need permission to handle Your Content. You grant us a
              worldwide, non-exclusive, royalty-free licence to host, store, copy, back up,
              transmit, resize, transcode, index and display Your Content, and to disclose it to the
              sub-processors listed in our{" "}
              <Link to="/privacy-policy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              , strictly for the purpose of providing and supporting the Services to you. This
              includes processing Your Content through AI providers to produce the analysis,
              transcripts, site logs and reports you ask for, and publishing it at the public
              addresses you choose to create. The licence lasts only as long as we hold the content,
              and ends when the content is deleted (subject to routine backup cycles).
            </p>
            <p className="text-muted-foreground mt-2">
              We do not use Your Content to advertise to third parties or sell it. You are
              responsible for keeping your own copies of anything you cannot afford to lose; the
              Services are not a substitute for your own records or backups.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              7. Job Sites and Third-Party Property
            </h2>
            <p className="text-muted-foreground">
              You are photographing property that usually belongs to someone else. You are solely
              responsible for having the right to capture, upload and use every photo, video and
              recording you put into the Services — including any permission required from the
              property owner or occupier, your client, the general contractor, or anyone whose face,
              vehicle, documents or possessions appear in the frame, and any consent required to
              record audio during walkthroughs.
            </p>
            <p className="text-muted-foreground mt-2">
              Photos captured in the field commonly carry embedded GPS coordinates and timestamps,
              which the Services read and store so your work can be mapped and sequenced. Treat that
              as location data about a private address and share it accordingly.
            </p>
            <p className="text-muted-foreground mt-2">
              You represent that you have all rights and permissions described above, and you will
              indemnify us against claims arising from content you upload or publish without them.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              8. Public Share Links and Portfolio Pages
            </h2>
            <p className="text-muted-foreground">
              The Services let you create links — to galleries, reports, project pages,
              walkthroughs, portfolio sites and website embeds — that are viewable by anyone who has
              the URL, without signing in. That is the intended behaviour of the feature.
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-muted-foreground">
              <li>
                Anyone the link is forwarded to can view it. Search engines may index a portfolio
                page or project page you publish.
              </li>
              <li>
                You decide what goes into a share link and are responsible for the consequences of
                publishing it — including any client, personal or site-security information visible
                in the photos, captions or reports it contains.
              </li>
              <li>
                Revoke a link from within the app when it should no longer be public. Copies already
                downloaded or cached by a recipient cannot be recalled.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              9. AI-Generated Output Is Not Authoritative
            </h2>
            <p className="text-muted-foreground">
              Some features use artificial intelligence to describe photos, flag apparent defects,
              transcribe walkthrough audio, and draft site logs and reports. AI output is generated
              automatically from limited information and{" "}
              <strong className="text-foreground">
                can be incomplete, inaccurate, or confidently wrong
              </strong>
              . It may miss a defect that is present or describe one that is not.
            </p>
            <p className="text-muted-foreground mt-2">
              AI-generated analysis, defect severity, condition assessments, measurements and
              recommendations are informational aids only. They are{" "}
              <strong className="text-foreground">
                not a professional inspection, engineering opinion, code-compliance determination,
                safety certification, or expert evidence
              </strong>
              , and they are not a substitute for inspection by a suitably qualified professional.
              We do not provide inspection, engineering, legal or insurance services.
            </p>
            <p className="text-muted-foreground mt-2">
              Reports produced in the Services are frequently used in change orders, warranty
              claims, insurance claims and disputes. You are responsible for reviewing, correcting
              and verifying any output before you rely on it, share it with a client, or submit it
              in a claim or proceeding. We accept no liability for decisions made in reliance on AI
              output.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">10. Third-Party Services</h2>
            <p className="text-muted-foreground">
              The Services depend on third-party providers — including cloud hosting and storage,
              payment processing, email delivery, mapping and geocoding, and AI providers. They are
              identified in our{" "}
              <Link to="/privacy-policy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              . Your use of the Services is also subject to those providers&apos; terms where they
              apply to you, and we are not responsible for their acts, omissions or outages beyond
              our reasonable control.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              11. Availability and Support
            </h2>
            <p className="text-muted-foreground">
              We work to keep the Services available and reliable, but they are provided{" "}
              <strong className="text-foreground">without any service level agreement</strong>. We
              do not commit to a specific uptime percentage, response time, or support-response
              time, and we offer no service credits, unless we have signed a separate written
              agreement with you that says otherwise. The Services may be unavailable during
              maintenance, provider outages, or events outside our control.
            </p>
            <p className="text-muted-foreground mt-2">
              Support is provided on a commercially reasonable basis through our{" "}
              <Link to="/contact" className="text-primary hover:underline">
                contact page
              </Link>{" "}
              and the in-app Help Center.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              12. Termination and Data Deletion
            </h2>
            <p className="text-muted-foreground">
              You may stop using the Services and delete your account at any time from the Settings
              page. We may suspend or terminate your access if you materially breach these Terms, if
              your subscription goes unpaid, or if we are required to by law — with notice where it
              is reasonable to give it.
            </p>
            <p className="text-muted-foreground mt-2">
              Export anything you need before you delete your account. On deletion we begin removing
              your account and associated content in line with the retention section of our{" "}
              <Link to="/privacy-policy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              , except where we must keep records for legal, tax, accounting, security or
              dispute-resolution purposes. Active share links stop working once the underlying
              content is deleted. Deletion is permanent and we cannot restore deleted workspaces.
            </p>
            <p className="text-muted-foreground mt-2">
              Sections 6, 9, 13, 14, 15 and 17 survive termination.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">13. Disclaimers</h2>
            <p className="text-muted-foreground">
              To the fullest extent permitted by law, the Services are provided &quot;as is&quot;
              and &quot;as available&quot;, without warranties of any kind, whether express, implied
              or statutory — including implied warranties of merchantability, fitness for a
              particular purpose, accuracy, and non-infringement. We do not warrant that the
              Services will be uninterrupted, error-free or secure, that stored content will never
              be lost or corrupted, or that AI output will be accurate or complete. Nothing in these
              Terms excludes liability that cannot lawfully be excluded.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              14. Limitation of Liability
            </h2>
            <p className="text-muted-foreground">
              To the fullest extent permitted by law, neither party is liable for indirect,
              incidental, special, consequential or punitive damages, or for lost profits, lost
              revenue, lost business, loss of goodwill, or loss or corruption of data, arising out
              of or relating to the Services — even if advised of the possibility.
            </p>
            <p className="text-muted-foreground mt-2">
              Our total aggregate liability arising out of or relating to the Services or these
              Terms will not exceed the total amount you paid us for the Services in the twelve (12)
              months immediately before the event giving rise to the claim.
            </p>
            <p className="text-muted-foreground mt-2">
              These limits apply to all claims, whether in contract, tort (including negligence),
              statute or otherwise, and reflect the allocation of risk between us at the prices
              charged.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">15. Indemnity</h2>
            <p className="text-muted-foreground">
              You will defend, indemnify and hold us harmless from third-party claims, damages and
              reasonable costs arising from Your Content, from your publication of share links or
              portfolio pages, from your use of the Services in breach of these Terms or applicable
              law, or from your reliance on AI-generated output.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              16. Changes to These Terms
            </h2>
            <p className="text-muted-foreground">
              We may update these Terms to reflect changes to the Services, our business, or legal
              requirements. We will post the updated Terms here and update the effective date, and
              for material changes we will give notice in the app or by email before they take
              effect. Continuing to use the Services after that date means you accept the revised
              Terms; if you do not, stop using the Services and cancel your subscription.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              17. Governing Law and Disputes
            </h2>
            <p className="text-muted-foreground">
              These Terms are governed by the laws of {GOVERNING_LAW}, without regard to
              conflict-of-law rules, and the courts of {GOVERNING_LAW} have exclusive jurisdiction
              over any dispute arising out of or relating to them — except that either party may
              seek injunctive relief in any court of competent jurisdiction to protect its
              intellectual property or confidential information. Nothing here removes any right you
              have to bring proceedings in your local courts where the law of your country of
              residence guarantees it.
            </p>
            <p className="text-muted-foreground mt-2">
              Before starting formal proceedings, please contact us so we can try to resolve the
              issue directly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">18. General</h2>
            <p className="text-muted-foreground">
              These Terms, together with the Privacy Policy, are the entire agreement between us
              about the Services. If any provision is held unenforceable, the rest remains in force.
              Our failure to enforce a provision is not a waiver of it. You may not assign these
              Terms without our consent; we may assign them to an affiliate or in connection with a
              merger, acquisition or sale of assets.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">19. Contact Us</h2>
            <p className="text-muted-foreground">
              Questions about these Terms? See our{" "}
              <Link to="/contact" className="text-primary hover:underline">
                contact page
              </Link>{" "}
              or write to us at:
            </p>
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-4">
              <p className="font-medium text-foreground">{LEGAL_ENTITY}</p>
              <p className="text-muted-foreground">{REGISTERED_ADDRESS}</p>
              <p className="text-muted-foreground">
                Email:{" "}
                {legalMailto ? (
                  <a href={legalMailto} className="text-primary hover:underline">
                    {LEGAL_EMAIL}
                  </a>
                ) : (
                  <span className="text-foreground">{LEGAL_EMAIL}</span>
                )}
              </p>
              <p className="text-muted-foreground">
                Website:{" "}
                <a href="https://www.everbreezesitepix.com" className="text-primary hover:underline">
                  everbreezesitepix.com
                </a>
              </p>
            </div>
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
