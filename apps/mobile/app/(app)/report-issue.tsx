import { useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { submitIssueReport } from "@/api/feedback";
import {
  appendErrorLog,
  cleanDescription,
  KINDS,
  messageError,
  type DeviceContext,
  type FeedbackKind,
} from "@/api/feedback-view";
import { errorsForSupport, recentErrors } from "@/lib/errors";
import { spacing } from "@/theme";
import { CircleCheck, LifeBuoy, Send, TriangleAlert } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Text,
} from "@/ui";

/**
 * Reporting a problem from the field.
 *
 * This was a row that opened a browser, which is a strange thing to offer
 * somebody whose complaint may well be that the app is not working. A report
 * has to be sendable from the thing that is broken.
 *
 * **The point of the screen is the error log.** A crew member reporting "the
 * team screen did not work" cannot say what the error said, and until
 * `errors.ts` existed nothing on the phone could either. Attaching the last few
 * failures turns an unactionable report into one with the actual message in it.
 * Every record is redacted once on the way in, so no access token, share link
 * or email address travels with it.
 *
 * It is opt-in and shown before sending, because attaching diagnostics to a
 * message without saying so is not a thing to do quietly.
 */
export default function ReportIssueScreen() {
  const { from, projectId } = useLocalSearchParams<{ from?: string; projectId?: string }>();

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [attachLog, setAttachLog] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Snapshotted on mount: the buffer keeps filling while somebody types, and a
  // report should carry what was on screen when they decided to write it.
  const log = useMemo(() => errorsForSupport(), []);
  const errorCount = useMemo(() => recentErrors().length, []);

  const context: DeviceContext = useMemo(
    () => ({
      platform: Platform.OS,
      osVersion: Device.osVersion ?? null,
      // Null on an emulator, which the composed user agent copes with.
      model: Device.modelName ?? null,
      appVersion: Constants.expoConfig?.version ?? null,
      screen: from ?? null,
    }),
    [from],
  );

  const send = useMutation({
    mutationFn: () =>
      submitIssueReport({
        kind,
        description: appendErrorLog(cleanDescription(message), log, attachLog),
        projectId: projectId ?? null,
        screen: from ?? null,
        context,
      }),
    onSuccess: () => setSent(true),
    onError: (error: unknown) =>
      setFormError(
        error instanceof Error ? error.message : "Could not send that. Try again in a moment.",
      ),
  });

  const submit = useCallback(() => {
    const bad = messageError(message);
    if (bad) {
      setFormError(bad);
      return;
    }
    setFormError(null);
    send.mutate();
  }, [message, send]);

  if (sent) {
    return (
      <>
        <Stack.Screen options={{ title: "Report a problem" }} />
        <Screen scroll>
          <View style={{ paddingTop: spacing.xxl, gap: spacing.lg, alignItems: "center" }}>
            <Badge label="Sent" tone="success" icon={CircleCheck} />
            <Text variant="title" align="center">
              Thanks, that is with us
            </Text>
            <Text variant="body" tone="muted" align="center">
              {/*
                No promise of a reply time. Support answers through the web app,
                and inventing an SLA here would be a commitment nobody made.
              */}
              We read every one. If we need more detail, we will reply to your account email.
            </Text>
            <Button label="Done" fullWidth onPress={() => router.back()} />
          </View>
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Report a problem" }} />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <SectionHeader title="What kind of thing" />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListGroup>
            {KINDS.map((option, index) => (
              <View key={option.id}>
                {index > 0 ? <RowDivider inset={false} /> : null}
                <ListRow
                  title={option.label}
                  subtitle={option.hint}
                  value={kind === option.id ? "Chosen" : undefined}
                  onPress={() => setKind(option.id)}
                />
              </View>
            ))}
          </ListGroup>
        </View>

        <SectionHeader title="What happened" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <Field
            value={message}
            onChangeText={(next) => {
              setMessage(next);
              if (formError) setFormError(null);
            }}
            placeholder="What you did, and what happened instead"
            multiline
            rows={6}
            error={formError ?? undefined}
          />

          {/*
            Opt-in, and it says exactly what travels. Attaching diagnostics to a
            message without saying so is not a thing to do quietly, and the one
            question anybody sensible asks is whether it carries their data.
          */}
          <ListGroup>
            <ListRow
              icon={TriangleAlert}
              iconTone={attachLog && errorCount > 0 ? "primary" : "muted"}
              title="Attach recent errors"
              subtitle={
                errorCount === 0
                  ? "Nothing has failed on this phone recently"
                  : `${errorCount} recent failure${errorCount === 1 ? "" : "s"}, with tokens and addresses removed`
              }
              right={
                <Badge
                  label={attachLog && errorCount > 0 ? "Yes" : "No"}
                  tone={attachLog && errorCount > 0 ? "primary" : "neutral"}
                  variant={attachLog && errorCount > 0 ? "soft" : "outline"}
                />
              }
              disabled={errorCount === 0}
              onPress={() => setAttachLog((current) => !current)}
            />
          </ListGroup>

          {attachLog && errorCount > 0 ? (
            <Card>
              <View style={{ gap: spacing.xs }}>
                <Text variant="caption" tone="muted">
                  This is what would be attached:
                </Text>
                {/* Shown, not summarised. Somebody agreeing to send diagnostics
                    should be able to read them first. */}
                <Text variant="caption" tone="muted" selectable numberOfLines={12}>
                  {log}
                </Text>
              </View>
            </Card>
          ) : null}

          <Button
            label={send.isPending ? "Sending" : "Send"}
            icon={Send}
            fullWidth
            disabled={send.isPending}
            onPress={submit}
          />

          <Text variant="caption" tone="muted">
            Your email and the device model go with this, so somebody can reply and reproduce it. No
            photos, documents or notes are sent.
          </Text>
        </View>

        <SectionHeader title="Looking for help instead" />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListGroup>
            <ListRow
              icon={LifeBuoy}
              title="Knowledge base"
              subtitle="How-to articles, opened in your browser"
              onPress={() => router.push("/account")}
            />
          </ListGroup>
        </View>
      </Screen>
    </>
  );
}
