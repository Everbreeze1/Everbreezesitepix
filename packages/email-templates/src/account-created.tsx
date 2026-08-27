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

interface AccountCreatedEmailProps {
  siteName: string;
  siteUrl: string;
  /** Where the button points: a one-shot set-password link, or the sign-in page. */
  actionUrl: string;
  /**
   * Which of the two admin-created shapes this is.
   *
   * `set_password` - nobody knows the password (we generated a throwaway one),
   * so the link IS how they get in and the copy has to say so.
   * `sign_in` - the admin typed a password and is passing it on themselves, so
   * promising a "choose your password" link here would be a lie.
   */
  mode: "set_password" | "sign_in";
  /** The workspace they were added to, when they were added to one. */
  teamName?: string | null;
  recipientName?: string | null;
}

/**
 * "An admin made you an account."
 *
 * Deliberately its own template rather than a reused invite or signup mail,
 * because it is answering a different question. A signup confirmation asks
 * somebody to prove an address they just typed; an invite asks them to accept
 * something. This one arrives unprompted, for an account the recipient never
 * asked for, so the first job of the copy is to explain why it exists at all -
 * otherwise the honest reading is phishing.
 *
 * Plain for the same reason InviteEmail is plain: see the note there. Gmail
 * classifies on rendered structure, and the one message that must not land in
 * Promotions is the one carrying somebody's only route into their account.
 */
export const AccountCreatedEmail = ({
  siteName,
  siteUrl,
  actionUrl,
  mode,
  teamName,
  recipientName,
}: AccountCreatedEmailProps) => {
  const workspace = teamName ?? siteName;
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {mode === "set_password"
          ? `Choose a password for your ${siteName} account`
          : `Your ${siteName} account is ready`}
      </Preview>
      <Body style={main}>
        <Container style={outer}>
          <Text style={wordmark}>Everlumen</Text>

          <Heading style={h1}>
            {mode === "set_password" ? "Choose your password" : "Your account is ready"}
          </Heading>

          <Text style={text}>
            {recipientName ? `${recipientName}, an` : "An"} account has been created for you on{" "}
            <strong style={strong}>{siteName}</strong>
            {teamName ? (
              <>
                {" "}
                in the <strong style={strong}>{workspace}</strong> workspace
              </>
            ) : null}
            .{" "}
            {mode === "set_password"
              ? "Pick a password below and you are in. Your email address is already confirmed, so there is nothing else to click."
              : "Whoever set it up will pass on your password. Your email address is already confirmed, so you can sign in straight away."}
          </Text>

          <Section style={buttonWrap}>
            <Button style={button} href={actionUrl}>
              {mode === "set_password" ? "Set my password" : "Sign in"}
            </Button>
          </Section>

          {/* Plenty of clients strip or fail to render the button, and this
              link is the recipient's only way into the account. */}
          <Text style={fallbackLabel}>Or paste this link into your browser:</Text>
          <Text style={fallbackUrl}>
            <Link href={actionUrl} style={fallbackLink}>
              {actionUrl}
            </Link>
          </Text>

          {mode === "set_password" ? (
            <Text style={meta}>
              This link can be used once and expires after an hour. If it has already gone stale,
              use Forgot password on the sign-in page - it reaches the same place.
            </Text>
          ) : null}

          <Hr style={hr} />

          <Text style={footer}>
            If you were not expecting this, you can ignore this email and nobody can sign in as you.{" "}
            <Link href={siteUrl} style={footerLink}>
              {siteName}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default AccountCreatedEmail;

/* Same tokens as invite.tsx - these two arrive back to back for a new crew
   member, and two different-looking messages read as two different senders. */
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
const fallbackLabel = { fontSize: "13px", color: "#6b7686", margin: "0 0 6px" };
const fallbackUrl = { fontSize: "13px", margin: "0 0 20px", wordBreak: "break-all" as const };
const fallbackLink = { color: "#1f5fa8", textDecoration: "underline" };
const meta = { fontSize: "13px", color: "#6b7686", margin: 0 };
const hr = { borderColor: "#e4e9f0", margin: "24px 0 14px" };
const footer = { fontSize: "12px", color: "#8b95a5", lineHeight: "1.6", margin: 0 };
const footerLink = { color: "#8b95a5", textDecoration: "underline" };
