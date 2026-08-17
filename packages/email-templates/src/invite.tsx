import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
  /**
   * The workspace they are being invited to, when we know it. The Supabase Auth
   * hook renders this same template for GoTrue's generic `invite` type and has
   * no team context, so everything below `confirmationUrl` is optional and the
   * copy degrades to the generic wording.
   */
  teamName?: string;
  /** Who sent it - a name if we have one, otherwise their email. */
  inviterName?: string;
  expiresInDays?: number;
}

/**
 * Deliberately plain.
 *
 * This started out as a branded card: navy banner with a wordmark, uppercase
 * accent eyebrow, 26px display heading, saturated blue CTA, tagline footer,
 * floating on a tinted canvas. Every one of those is a marketing-template
 * signal, and Gmail's tab classifier reads rendered structure - so the first
 * mail a new user ever got from us landed in **Promotions**, next to Wayfair
 * and The Home Depot, where nobody looks for an invitation.
 *
 * What replaced it reads like correspondence instead of a campaign: white page
 * (no card-on-canvas), a letterhead-sized wordmark rather than a banner, left
 * aligned, one sentence of plain copy, a dark neutral button rather than a
 * bright brand-colour CTA, and no product pitch or tagline in the footer.
 *
 * Tab placement is a per-recipient ML guess, never a guarantee - this removes
 * the signals we control, it does not "set" the tab. Keep that in mind before
 * adding a hero image, a logo band, a second CTA, or feature-benefit copy here:
 * each one buys back a bit of the Promotions risk.
 */
export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
  teamName,
  inviterName,
  expiresInDays,
}: InviteEmailProps) => {
  const target = teamName ?? siteName;
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {inviterName
          ? `${inviterName} invited you to ${target} on ${siteName}`
          : `You've been invited to join ${target}`}
      </Preview>
      <Body style={main}>
        <Container style={outer}>
          {/* Letterhead, not a banner. A wordmark rather than an image: remote
              images are blocked by default in most clients, so a logo would
              leave a broken box at the top of the very first email someone
              gets from us. */}
          <Text style={wordmark}>Everbreeze SitePix</Text>

          <Heading style={h1}>{teamName ? `Join ${teamName}` : "You've been invited"}</Heading>

          <Text style={text}>
            {inviterName ? (
              <>
                <strong style={strong}>{inviterName}</strong> has invited you to join{" "}
                <strong style={strong}>{target}</strong> on {siteName}.
              </>
            ) : (
              <>
                You've been invited to join <strong style={strong}>{target}</strong> on {siteName}.
              </>
            )}
          </Text>

          <Section style={buttonWrap}>
            <Button style={button} href={confirmationUrl}>
              Accept invitation
            </Button>
          </Section>

          {/* Plain URL fallback. Plenty of clients strip or fail to render the
              button, and an invite with no usable link is a dead end. */}
          <Text style={fallbackLabel}>Or paste this link into your browser:</Text>
          <Text style={fallbackUrl}>
            <Link href={confirmationUrl} style={fallbackLink}>
              {confirmationUrl}
            </Link>
          </Text>

          {expiresInDays ? (
            <Text style={meta}>This invitation expires in {expiresInDays} days.</Text>
          ) : null}

          <Hr style={hr} />

          <Text style={footer}>
            If you weren't expecting this invitation you can ignore this email - nothing will be
            created for you.{" "}
            <Link href={siteUrl} style={footerLink}>
              {siteName}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default InviteEmail;

/* Brand tokens mirrored from apps/web/src/styles.css - --sidebar #101929.
   Email needs literal hex; there are no CSS variables.

   --sidebar-ring #2584f4 is deliberately absent from the button below: a large
   saturated CTA is the single loudest "campaign" cue in the layout. The button
   is navy instead, which still reads as the primary action. */
const NAVY = "#101929";

const main = {
  backgroundColor: "#ffffff",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  padding: "24px 0",
  margin: 0,
};
const outer = { maxWidth: "520px", margin: "0 auto", padding: "0 20px" };
const wordmark = {
  margin: "0 0 28px",
  fontSize: "13px",
  fontWeight: 600 as const,
  color: "#8b95a5",
};
const h1 = {
  fontSize: "20px",
  fontWeight: 700 as const,
  color: NAVY,
  lineHeight: "1.3",
  margin: "0 0 14px",
};
const text = {
  fontSize: "15px",
  color: "#3d4756",
  lineHeight: "1.6",
  margin: "0 0 24px",
};
const strong = { color: NAVY, fontWeight: 600 as const };
const buttonWrap = { margin: "0 0 24px" };
const button = {
  backgroundColor: NAVY,
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600 as const,
  borderRadius: "6px",
  padding: "11px 20px",
  textDecoration: "none",
  display: "inline-block",
};
const fallbackLabel = {
  fontSize: "13px",
  color: "#6b7686",
  margin: "0 0 6px",
};
const fallbackUrl = {
  fontSize: "13px",
  margin: "0 0 20px",
  wordBreak: "break-all" as const,
};
/* Underlined and a muted blue - a link that looks like a link, not like the
   accent-coloured "click here" of a campaign. */
const fallbackLink = { color: "#1f5fa8", textDecoration: "underline" };
const meta = {
  fontSize: "13px",
  color: "#6b7686",
  margin: 0,
};
const hr = { borderColor: "#e4e9f0", margin: "24px 0 14px" };
const footer = {
  fontSize: "12px",
  color: "#8b95a5",
  lineHeight: "1.6",
  margin: 0,
};
const footerLink = { color: "#8b95a5", textDecoration: "underline" };
