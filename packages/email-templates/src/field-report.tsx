import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface FieldReportEmailProps {
  siteName: string;
  subject: string;
  downloadUrl: string;
  expiresInDays: number;
}

export const FieldReportEmail = ({
  siteName,
  subject,
  downloadUrl,
  expiresInDays,
}: FieldReportEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {siteName} field report is ready to download</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your field report is ready</Heading>
        <Text style={text}>
          Your report <strong>{subject}</strong> has been generated and is available for download.
        </Text>
        <Section style={{ textAlign: "center", margin: "32px 0" }}>
          <Button style={button} href={downloadUrl}>
            Download Report (PDF)
          </Button>
        </Section>
        <Text style={muted}>
          This secure download link will expire in {expiresInDays} days. Save the file locally if
          you need long-term access.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          Sent by {siteName}. If you didn't request this report, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default FieldReportEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "24px 28px", maxWidth: "560px" };
const h1 = {
  fontSize: "22px",
  fontWeight: "bold" as const,
  color: "#0f172a",
  margin: "0 0 16px",
};
const text = {
  fontSize: "15px",
  color: "#334155",
  lineHeight: "1.6",
  margin: "0 0 12px",
};
const muted = {
  fontSize: "13px",
  color: "#64748b",
  lineHeight: "1.6",
  margin: "16px 0 0",
};
const button = {
  backgroundColor: "#0f172a",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "bold" as const,
  borderRadius: "10px",
  padding: "14px 28px",
  textDecoration: "none",
  display: "inline-block",
};
const hr = { borderColor: "#e2e8f0", margin: "28px 0 16px" };
const footer = { fontSize: "12px", color: "#94a3b8", margin: 0 };
