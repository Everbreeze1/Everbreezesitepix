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

interface TaskNotificationEmailProps {
  siteName: string;
  siteUrl: string;
  /** Deep link back into the app, already pointing at the task. */
  taskUrl: string;
  /** "New task assigned to you", "Task completed", "Mark commented on a task". */
  headline: string;
  /** The task's own title, which is what the reader actually has to recognise. */
  taskTitle: string;
  /** The project the task belongs to, when we know it. */
  projectName?: string | null;
  /** Who caused this - the person who assigned, closed or wrote. */
  actorName?: string | null;
  /** A comment's text, or a task's description. Optional and quoted. */
  message?: string | null;
  /** Due date, already formatted for a human. */
  dueLabel?: string | null;
  /** "Urgent" / "High". Absent for normal and low, which are not news. */
  priorityLabel?: string | null;
  /** Label under the button, e.g. "Open task". */
  ctaLabel?: string;
}

/**
 * One email for everything a task can do to you.
 *
 * Deliberately plain, for the reason spelled out at length in `invite.tsx`: a
 * branded card with a banner and a saturated CTA is a bundle of campaign
 * signals, and Gmail's tab classifier reads rendered structure. Work mail that
 * lands in Promotions is work nobody sees, which is the exact failure this
 * whole feature exists to fix - the client's report was that an assigned crew
 * member "has no way to know new work landed on them".
 *
 * So: white page, letterhead wordmark, one heading, the task's title as the
 * loudest line on the page, and a dark neutral button. No hero, no logo band,
 * no feature copy.
 *
 * The facts a person needs to decide whether to open the app are in the body
 * rather than behind the link: what the task is called, who it is on, when it
 * is due, and how urgent. A notification email that says only "you have a
 * notification" makes the reader do the work twice.
 */
export const TaskNotificationEmail = ({
  siteName,
  siteUrl,
  taskUrl,
  headline,
  taskTitle,
  projectName,
  actorName,
  message,
  dueLabel,
  priorityLabel,
  ctaLabel,
}: TaskNotificationEmailProps) => {
  const meta = [
    projectName ? `Project: ${projectName}` : null,
    dueLabel ? `Due: ${dueLabel}` : null,
    priorityLabel ? `Priority: ${priorityLabel}` : null,
  ].filter(Boolean) as string[];

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${headline}: ${taskTitle}`}</Preview>
      <Body style={main}>
        <Container style={outer}>
          <Text style={wordmark}>Everlumen</Text>

          <Heading style={h1}>{headline}</Heading>

          {actorName ? (
            <Text style={byline}>
              from <strong style={strong}>{actorName}</strong>
            </Text>
          ) : null}

          {/* The task's name, given the weight it deserves. This is the line
              that tells a tech standing on a roof whether to stop what they are
              doing. */}
          <Text style={taskTitleStyle}>{taskTitle}</Text>

          {meta.length > 0 ? <Text style={metaLine}>{meta.join("  ·  ")}</Text> : null}

          {message ? (
            <Section style={quoteWrap}>
              <Text style={quote}>{message}</Text>
            </Section>
          ) : null}

          <Section style={buttonWrap}>
            <Button style={button} href={taskUrl}>
              {ctaLabel ?? "Open task"}
            </Button>
          </Section>

          {/* Plenty of clients strip or fail to render the button, and a work
              notification with no usable link is a dead end. */}
          <Text style={fallbackLabel}>Or paste this link into your browser:</Text>
          <Text style={fallbackUrl}>
            <Link href={taskUrl} style={fallbackLink}>
              {taskUrl}
            </Link>
          </Text>

          <Hr style={hr} />

          {/* No "manage your preferences" line: the Notifications section in
              Settings is stored in the browser's localStorage and the server
              has never been able to read it, so a link there would promise a
              switch that does nothing. This is transactional mail about work
              somebody handed you, and it says exactly why it arrived. */}
          <Text style={footer}>
            You are getting this because you are on this task in {siteName}.{" "}
            <Link href={siteUrl} style={footerLink}>
              {siteUrl.replace(/^https?:\/\//, "")}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default TaskNotificationEmail;

/* Brand tokens mirrored from apps/web/src/styles.css - --sidebar #101929.
   Email needs literal hex; there are no CSS variables. Same restraint as
   invite.tsx: no accent-coloured CTA. */
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
  margin: "0 0 6px",
};
const byline = {
  fontSize: "14px",
  color: "#6b7686",
  lineHeight: "1.5",
  margin: "0 0 18px",
};
const strong = { color: NAVY, fontWeight: 600 as const };
const taskTitleStyle = {
  fontSize: "17px",
  fontWeight: 600 as const,
  color: NAVY,
  lineHeight: "1.45",
  margin: "0 0 8px",
};
const metaLine = {
  fontSize: "13px",
  color: "#6b7686",
  lineHeight: "1.6",
  margin: "0 0 20px",
};
const quoteWrap = { margin: "0 0 24px" };
/* A left rule rather than a tinted panel: a filled callout box is one more
   card-shaped element, and this has to read as a quoted line in a letter. */
const quote = {
  fontSize: "15px",
  color: "#3d4756",
  lineHeight: "1.6",
  margin: 0,
  paddingLeft: "14px",
  borderLeft: `3px solid #e4e9f0`,
  whiteSpace: "pre-wrap" as const,
};
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
const fallbackLink = { color: "#1f5fa8", textDecoration: "underline" };
const hr = { borderColor: "#e4e9f0", margin: "24px 0 14px" };
const footer = {
  fontSize: "12px",
  color: "#8b95a5",
  lineHeight: "1.6",
  margin: 0,
};
const footerLink = { color: "#8b95a5", textDecoration: "underline" };
