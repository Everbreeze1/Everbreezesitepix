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
  /** Who sent it — a name if we have one, otherwise their email. */
  inviterName?: string;
  expiresInDays?: number;
}

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
          {/* Brand band. A wordmark rather than an image: remote images are
              blocked by default in most clients, so a logo would leave a broken
              box at the top of the very first email someone gets from us. */}
          <Section style={header}>
            <Text style={wordmark}>
              Everbreeze <span style={wordmarkAccent}>SitePix</span>
            </Text>
          </Section>

          <Section style={card}>
            <Text style={eyebrow}>Team invitation</Text>
            <Heading style={h1}>{teamName ? `Join ${teamName}` : "You've been invited"}</Heading>

            <Text style={text}>
              {inviterName ? (
                <>
                  <strong style={strong}>{inviterName}</strong> has invited you to join{" "}
                  <strong style={strong}>{target}</strong> on {siteName}.
                </>
              ) : (
                <>
                  You've been invited to join <strong style={strong}>{target}</strong> on {siteName}
                  .
                </>
              )}{" "}
              You'll be able to capture site photos, run walkthroughs, and share project reports
              with the rest of the crew.
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
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            If you weren't expecting this invitation, you can safely ignore this email — nothing
            will be created for you.
          </Text>
          <Text style={footerBrand}>
            <Link href={siteUrl} style={footerLink}>
              {siteName}
            </Link>
            {" · "}Field documentation for construction teams
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default InviteEmail;

/* Brand tokens mirrored from apps/web/src/styles.css — --sidebar #101929 and
   --sidebar-ring #2584f4. Email needs literal hex; there are no CSS variables. */
const NAVY = "#101929";
const ACCENT = "#2584f4";

const main = {
  backgroundColor: "#f4f6fa",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  padding: "32px 0",
  margin: 0,
};
const outer = { maxWidth: "520px", margin: "0 auto", padding: "0 16px" };
const header = {
  backgroundColor: NAVY,
  borderRadius: "14px 14px 0 0",
  padding: "22px 28px",
};
const wordmark = {
  margin: 0,
  fontSize: "17px",
  fontWeight: 800 as const,
  letterSpacing: "-0.3px",
  color: "#ffffff",
};
const wordmarkAccent = { color: ACCENT };
const card = {
  backgroundColor: "#ffffff",
  borderRadius: "0 0 14px 14px",
  padding: "32px 28px 28px",
};
const eyebrow = {
  margin: "0 0 10px",
  fontSize: "11px",
  fontWeight: 800 as const,
  letterSpacing: "1.4px",
  textTransform: "uppercase" as const,
  color: ACCENT,
};
const h1 = {
  fontSize: "26px",
  fontWeight: 800 as const,
  color: NAVY,
  lineHeight: "1.2",
  margin: "0 0 16px",
};
const text = {
  fontSize: "15px",
  color: "#4a5566",
  lineHeight: "1.65",
  margin: "0 0 28px",
};
const strong = { color: NAVY, fontWeight: 700 as const };
const buttonWrap = { margin: "0 0 26px" };
const button = {
  backgroundColor: ACCENT,
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 700 as const,
  borderRadius: "10px",
  padding: "14px 28px",
  textDecoration: "none",
  display: "inline-block",
};
const fallbackLabel = {
  fontSize: "12px",
  color: "#8b95a5",
  margin: "0 0 6px",
};
const fallbackUrl = {
  fontSize: "12px",
  margin: "0 0 22px",
  wordBreak: "break-all" as const,
};
const fallbackLink = { color: ACCENT, textDecoration: "none" };
const meta = {
  fontSize: "12px",
  color: "#8b95a5",
  margin: 0,
  paddingTop: "18px",
  borderTop: "1px solid #eef1f6",
};
const hr = { borderColor: "#e4e9f0", margin: "26px 0 16px" };
const footer = {
  fontSize: "12px",
  color: "#8b95a5",
  lineHeight: "1.6",
  margin: "0 0 8px",
  textAlign: "center" as const,
};
const footerBrand = {
  fontSize: "12px",
  color: "#a2abba",
  margin: 0,
  textAlign: "center" as const,
};
const footerLink = { color: "#8b95a5", textDecoration: "none", fontWeight: 700 as const };
