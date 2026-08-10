import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";
import { SiteFooter } from "@/components/SiteFooter";
import { POLICY_LAST_UPDATED, PRIVACY_EMAIL, mailtoHref } from "@/lib/contact";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Everbreeze SitePix" },
      {
        name: "description",
        content:
          "Privacy Policy for Everbreeze SitePix. Learn how we collect, use, store, and protect your personal information, job site photos, and AI analysis data.",
      },
      { property: "og:title", content: "Privacy Policy — Everbreeze SitePix" },
      {
        property: "og:description",
        content:
          "Privacy Policy for Everbreeze SitePix. Learn how we collect, use, store, and protect your personal information, job site photos, and AI analysis data.",
      },
      { property: "og:url", content: "https://www.everbreezesitepix.com/privacy-policy" },
    ],
    links: [{ rel: "canonical", href: "https://www.everbreezesitepix.com/privacy-policy" }],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  // This revision materially expanded the third-party/AI disclosures, so the
  // old "June 3, 2026" date would misstate when the current terms took effect.
  // Set POLICY_LAST_UPDATED to the date this revision is published.
  const lastUpdated = POLICY_LAST_UPDATED;
  const privacyMailto = mailtoHref(PRIVACY_EMAIL);

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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        </div>

        <div className="space-y-10 text-sm leading-7 text-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Introduction</h2>
            <p className="text-muted-foreground">
              Everbreeze SitePix (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed
              to protecting your privacy. This Privacy Policy explains how we collect, use,
              disclose, and safeguard your information when you use our mobile and web application,
              website, and related services (collectively, the &quot;Services&quot;). By using
              Everbreeze SitePix, you consent to the practices described in this policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              2. Information We Collect
            </h2>
            <div className="space-y-4 text-muted-foreground">
              <div>
                <h3 className="font-medium text-foreground">Personal Information</h3>
                <p>
                  When you create an account, we collect your name, email address, and any profile
                  information you choose to provide. If you sign in via Google or Apple OAuth, we
                  receive your name, email, and profile photo from those providers.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Job Site Photos and Media</h3>
                <p>
                  You may upload photos, videos, and other media files related to construction
                  projects and job sites. This includes image metadata such as timestamps, GPS
                  location (if enabled), and device information.
                </p>
                <p className="mt-2">
                  <strong className="text-foreground">EXIF and location data.</strong> When you add
                  a photo, the app reads the EXIF metadata embedded in the file by your camera and
                  extracts the original capture time and the GPS latitude and longitude, storing
                  them alongside the photo so it can be placed on the project map and timeline. If a
                  photo carries no GPS data we fall back to the coordinates of the project address.
                  Because these coordinates identify the job site — usually a private property
                  belonging to your client — treat them as location data and consider that before
                  publishing a photo through a public share link. You can strip EXIF data from a
                  file before uploading it if you do not want us to receive it.
                </p>
                <p className="mt-2">
                  <strong className="text-foreground">Walkthrough recordings.</strong> Walkthrough
                  video and audio you record in the app, including anything spoken on site, is
                  uploaded, stored, and transcribed. Make sure everyone recorded has consented where
                  the law requires it.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Usage Data</h3>
                <p>
                  We collect information about how you interact with our Services, including log
                  data, device information, IP address, browser type, pages visited, and features
                  used. This helps us improve performance and user experience.
                </p>
              </div>
              <div>
                <h3 className="font-medium text-foreground">AI Analysis Data</h3>
                <p>
                  When you use our AI-powered features, we process your uploaded photos and text
                  queries to generate analysis, summaries, and recommendations. The content of your
                  conversations and uploaded images are sent to AI providers (such as Google Gemini)
                  for processing.
                </p>
                <p className="mt-2">
                  Concretely: photo analysis, AI-assisted captions, site logs, project reports,
                  walkthrough summaries, and the in-app assistant all send your photos and the
                  associated captions, tags, and notes to{" "}
                  <strong className="text-foreground">Google Gemini</strong>. Photos are shared as
                  short-lived signed links to our storage that Google fetches to read the image.
                  Walkthrough audio and video is uploaded to Gemini for speech-to-text
                  transcription, so anything spoken during a recording is transmitted. Addresses you
                  enter are sent to Google Maps for geocoding, and text you have read aloud is sent
                  to Google Cloud Text-to-Speech. See section 4 for the full list of processors.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              3. How We Use Information
            </h2>
            <p className="text-muted-foreground">We use the information we collect to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-muted-foreground">
              <li>Provide, maintain, and improve the Services</li>
              <li>Authenticate your identity and manage your account</li>
              <li>Process and store your job site photos and project data</li>
              <li>Generate AI-powered analysis, site logs, and reports</li>
              <li>Send transactional emails, notifications, and support communications</li>
              <li>Analyze usage trends to improve features and performance</li>
              <li>Detect and prevent fraud, abuse, and security incidents</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              4. Data Sharing and Third Parties
            </h2>
            <p className="text-muted-foreground">
              We do not sell your personal information. We only share data with trusted third-party
              service providers necessary to operate our Services:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">Supabase</strong> — For database hosting,
                authentication, and file storage. Your account data, project information, and photos
                are stored securely in Supabase infrastructure.
              </li>
              <li>
                <strong className="text-foreground">Google Gemini / AI Providers</strong> — For
                AI-powered analysis features. When you use AI features, your photos and text queries
                may be processed by Google Gemini. These providers have their own privacy policies
                governing AI data processing.
              </li>
              <li>
                <strong className="text-foreground">Google Cloud Text-to-Speech</strong> — Text you
                ask the app to read aloud is sent to Google to synthesise the audio.
              </li>
              <li>
                <strong className="text-foreground">Google Maps Platform</strong> — Project and job
                site addresses you enter are sent to Google&apos;s Geocoding and Maps APIs to
                convert them to coordinates and render map views.
              </li>
              <li>
                <strong className="text-foreground">Stripe</strong> — For subscription payments.
                Stripe receives your billing details and card data directly; we store only a
                customer and subscription reference, never your full card number.
              </li>
              <li>
                <strong className="text-foreground">Resend</strong> — For transactional email such
                as team invitations, share notifications, and account messages. Resend receives the
                recipient address and message content.
              </li>
              <li>
                <strong className="text-foreground">Vercel and Railway</strong> — For hosting the
                website and the API. They process request data (including IP address and user agent)
                and keep short-lived operational logs.
              </li>
              <li>
                {/* No analytics SDK ships in the app today, so this stays as the
                    forward-looking "may use" wording it has always had. Name the
                    provider here the day one is added. */}
                <strong className="text-foreground">Analytics Providers</strong> — We may use
                anonymized analytics tools to understand app usage and performance.
              </li>
            </ul>
            <p className="text-muted-foreground mt-3">
              These providers act as our sub-processors and are permitted to use your data only to
              provide their service to us. Each keeps its own privacy policy, and the AI, mapping,
              email and hosting providers listed above may process data outside your country (see
              section 10).
            </p>
            <p className="text-muted-foreground mt-2">
              <strong className="text-foreground">Public share links.</strong> When you create a
              share link, portfolio page, project page, or website embed, the photos, captions and
              report content you include become viewable by anyone who has the URL — no sign-in
              required — and published portfolio and project pages may be indexed by search engines.
              You control what goes into a share link and you can revoke it from within the app.
            </p>
            <p className="text-muted-foreground mt-3">
              We may also disclose information if required by law, to protect our rights, or in
              connection with a business transfer (merger, acquisition, or asset sale).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              5. Data Storage and Security
            </h2>
            <p className="text-muted-foreground">
              Your data is stored on secure cloud servers provided by Supabase, with encryption at
              rest and in transit. We implement industry-standard security measures including
              SSL/TLS encryption, access controls, and regular security audits.
            </p>
            <p className="text-muted-foreground mt-2">
              However, no method of electronic transmission or storage is 100% secure. While we
              strive to protect your information, we cannot guarantee absolute security. You are
              responsible for maintaining the confidentiality of your account credentials.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. User Rights</h2>
            <p className="text-muted-foreground">
              Depending on your location, you may have the following rights regarding your personal
              data:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">Access</strong> — Request a copy of the personal
                data we hold about you.
              </li>
              <li>
                <strong className="text-foreground">Correction</strong> — Request that we correct
                inaccurate or incomplete information.
              </li>
              <li>
                <strong className="text-foreground">Deletion</strong> — Request deletion of your
                account and associated data. You can delete your account at any time from the
                Settings page.
              </li>
              <li>
                <strong className="text-foreground">Portability</strong> — Request your data in a
                structured, machine-readable format.
              </li>
              <li>
                <strong className="text-foreground">Restriction</strong> — Request that we limit how
                we use your data in certain circumstances.
              </li>
              <li>
                <strong className="text-foreground">Objection</strong> — Object to processing based
                on legitimate interests.
              </li>
            </ul>
            <p className="text-muted-foreground mt-3">
              To exercise any of these rights, please contact us at the email address below. We will
              respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Cookies and Analytics</h2>
            <p className="text-muted-foreground">
              We use cookies and similar technologies to remember your preferences (such as
              dark/light theme), keep you signed in, and analyze app usage. You can control cookies
              through your browser settings, though disabling certain cookies may affect
              functionality.
            </p>
            <p className="text-muted-foreground mt-2">
              We use analytics tools to collect aggregated, non-identifying usage data to help us
              understand how users interact with our Services and identify areas for improvement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              8. Children&apos;s Privacy
            </h2>
            <p className="text-muted-foreground">
              Our Services are not intended for individuals under the age of 13 (or the minimum age
              required in your jurisdiction). We do not knowingly collect personal information from
              children. If you believe we have inadvertently collected data from a child, please
              contact us immediately and we will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. Data Retention</h2>
            <p className="text-muted-foreground">
              We retain your personal data for as long as your account is active or as needed to
              provide you with the Services. If you delete your account, we will begin the process
              of deleting your data within 30 days, except where retention is necessary for legal
              compliance, dispute resolution, or enforcing our agreements.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              10. International Data Transfers
            </h2>
            <p className="text-muted-foreground">
              Your information may be transferred to and processed in countries other than your
              country of residence, including the United States. These countries may have data
              protection laws that differ from those in your jurisdiction. We take appropriate
              safeguards to ensure your data remains protected in accordance with this Privacy
              Policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              11. Changes to This Policy
            </h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy from time to time to reflect changes in our
              practices, legal requirements, or service offerings. We will notify you of material
              changes by posting the updated policy in the app and updating the &quot;Last
              updated&quot; date. Your continued use of the Services after changes take effect
              constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">12. Contact Us</h2>
            <p className="text-muted-foreground">
              If you have any questions, concerns, or requests regarding this Privacy Policy or our
              data practices, see our{" "}
              <Link to="/contact" className="text-primary hover:underline">
                contact page
              </Link>{" "}
              or write to us at:
            </p>
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-4">
              <p className="font-medium text-foreground">Everbreeze SitePix</p>
              <p className="text-muted-foreground">
                Email:{" "}
                {/* Was privacy@everbreeze.io — a domain that is not the product
                    domain. Held as a placeholder until the owner confirms the
                    real mailbox rather than publishing one that may bounce. */}
                {privacyMailto ? (
                  <a href={privacyMailto} className="text-primary hover:underline">
                    {PRIVACY_EMAIL}
                  </a>
                ) : (
                  <span className="text-foreground">{PRIVACY_EMAIL}</span>
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
