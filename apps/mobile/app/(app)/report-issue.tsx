import { useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { submitIssueReport, uploadFeedbackAttachments } from "@/api/feedback";
import {
  appendErrorLog,
  attachmentIssue,
  cleanDescription,
  cleanSubject,
  formatBytes,
  KINDS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_SUBJECT,
  messageError,
  subjectError,
  type DeviceContext,
  type FeedbackKind,
  type PickedAttachment,
} from "@/api/feedback-view";
import { errorsForSupport, recentErrors } from "@/lib/errors";
import { useAuth } from "@/lib/auth";
import { radius, spacing } from "@/theme";
import { CircleCheck, Images, LifeBuoy, Send, TriangleAlert, X } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  PhotoThumb,
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
 *
 * Screenshots are the second channel. The web page has accepted them since
 * 20260921000000; the phone could not, which left the surface where a visual
 * bug - a camera, a screen, a capture flow - is most likely to happen without a
 * picture. They are picked up to `MAX_ATTACHMENTS`, verified against the same
 * bucket rules the web uses, shown before sending, and uploaded only at send
 * time so a report abandoned midway leaves nothing behind.
 */
export default function ReportIssueScreen() {
  const { from, projectId } = useLocalSearchParams<{ from?: string; projectId?: string }>();
  const { user } = useAuth();

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachLog, setAttachLog] = useState(true);
  // Screenshots the reporter picked, shown before sending and uploaded at send
  // time (matching the web, so a report abandoned at the last second leaves
  // nothing in the bucket).
  const [picked, setPicked] = useState<PickedAttachment[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Snapshotted on mount: the buffer keeps filling while somebody types, and a
  // report should carry what was on screen when they decided to write it.
  const log = useMemo(() => errorsForSupport(), []);
  const errorCount = useMemo(() => recentErrors().length, []);

  /*
   * Whether anything is actually being attached, as one value.
   *
   * The switch being on is not enough: `errorsForSupport` answers with the
   * sentence "No errors recorded on this phone." rather than an empty string,
   * which is right for the preview below and wrong for the report body. Sending
   * on `attachLog` alone appended a "Recent errors" heading followed by that
   * sentence to every report from a phone that had not failed, so support read a
   * diagnostics section that carried no diagnostics.
   *
   * Held here rather than repeated at each use, because the badge, the preview
   * and the send path have to agree and this drifted once already.
   */
  const attaching = attachLog && errorCount > 0;

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
    mutationFn: async () => {
      let attachmentPaths: string[] = [];
      if (kind === "bug" && user?.id && picked.length) {
        const result = await uploadFeedbackAttachments(user.id, picked);
        attachmentPaths = result.paths;
        if (result.failed.length) {
          // The report still goes. Losing it because a screenshot would not
          // upload is the wrong trade.
          setFormError(`Couldn't attach ${result.failed.join(", ")} - sending the rest.`);
        }
      }
      return submitIssueReport({
        kind,
        subject: cleanSubject(kind, subject),
        description: appendErrorLog(cleanDescription(message), log, attaching),
        projectId: projectId ?? null,
        screen: from ?? null,
        context,
        attachments: attachmentPaths,
      });
    },
    onSuccess: () => setSent(true),
    onError: (error: unknown) =>
      setFormError(
        error instanceof Error ? error.message : "Could not send that. Try again in a moment.",
      ),
  });

  /**
   * Opens the photo library, capped at the slots left on the report.
   *
   * The bucket rejects anything that is not a PNG/JPEG/GIF/WebP under 10 MB
   * (20260921000000), and a file the server will drop must be turned away
   * here - when it can still be swapped - not discovered after the report has
   * gone out without it.
   */
  const addScreenshots = useCallback(async () => {
    const room = MAX_ATTACHMENTS - picked.length;
    if (room <= 0) return;
    const granted = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted.granted) {
      setFormError("Photo library permission is required to attach a screenshot.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 1,
    });
    if (result.canceled) return;

    const complaints: string[] = [];
    const kept: PickedAttachment[] = [];
    for (const asset of result.assets) {
      const ext =
        asset.mimeType === "image/jpeg"
          ? "jpg"
          : asset.mimeType === "image/gif"
            ? "gif"
            : asset.mimeType === "image/webp"
              ? "webp"
              : "png";
      const candidate: PickedAttachment = {
        uri: asset.uri,
        name: asset.fileName ?? `screenshot-${Date.now()}-${kept.length}.${ext}`,
        sizeBytes: asset.fileSize ?? 0,
        mimeType: asset.mimeType ?? "",
      };
      const issue = attachmentIssue(candidate, [...picked, ...kept]);
      if (issue) {
        complaints.push(
          issue.kind === "size"
            ? `${issue.name} is ${formatBytes(issue.sizeBytes)}, over the ${formatBytes(
                MAX_ATTACHMENT_BYTES,
              )} limit`
            : issue.kind === "type"
              ? `${issue.name} isn't an accepted image type - PNG, JPEG, GIF or WebP only`
              : `${issue.name} is already attached`,
        );
        continue;
      }
      kept.push(candidate);
    }
    if (kept.length) setPicked((prev) => [...prev, ...kept]);
    if (complaints.length) setFormError(complaints.slice(0, 3).join(". "));
  }, [picked]);

  const removeScreenshot = useCallback((index: number) => {
    setPicked((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const submit = useCallback(() => {
    const noSubject = subjectError(kind, subject);
    if (noSubject) {
      setFormError(noSubject);
      return;
    }
    const bad = messageError(message);
    if (bad) {
      setFormError(bad);
      return;
    }
    setFormError(null);
    send.mutate();
  }, [kind, subject, message, send]);

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
          {/*
            Bugs only. The subject is the line the feedback queue is scanned by,
            so it is asked for right where the bug is described. Ideas and praise
            are filed without one, matching what the web submits.
          */}
          {kind === "bug" ? (
            <Field
              label="Subject"
              value={subject}
              onChangeText={(next) => {
                setSubject(next.slice(0, MAX_SUBJECT));
                if (formError) setFormError(null);
              }}
              placeholder="One line, e.g. Photos will not upload on site"
            />
          ) : null}
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
              iconTone={attaching ? "primary" : "muted"}
              title="Attach recent errors"
              subtitle={
                errorCount === 0
                  ? "Nothing has failed on this phone recently"
                  : `${errorCount} recent failure${errorCount === 1 ? "" : "s"}, with tokens and addresses removed`
              }
              right={
                <Badge
                  label={attaching ? "Yes" : "No"}
                  tone={attaching ? "primary" : "neutral"}
                  variant={attaching ? "soft" : "outline"}
                />
              }
              disabled={errorCount === 0}
              onPress={() => setAttachLog((current) => !current)}
            />
          </ListGroup>

          {attaching ? (
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

          {/*
            Screenshots, bugs only and signed-in only. The web page has offered
            a picture since 20260921000000; the phone could not, and it was the
            one surface where a bug - a camera, a screen, a capture flow - is
            most likely to need one. Uploading happens at send time, so backing
            out leaves nothing in the bucket. Attachments need RLS, and RLS
            needs a session, so the row only shows when there is one.
          */}
          {kind === "bug" && user ? (
            <>
              <ListGroup>
                <ListRow
                  icon={Images}
                  iconTone={picked.length ? "primary" : "muted"}
                  title="Attach screenshots"
                  subtitle={
                    picked.length === 0
                      ? `Up to ${MAX_ATTACHMENTS} images, ${formatBytes(
                          MAX_ATTACHMENT_BYTES,
                        )} each. They go with the report.`
                      : picked.length >= MAX_ATTACHMENTS
                        ? "Maximum reached"
                        : `Add another - ${picked.length} of ${MAX_ATTACHMENTS} attached`
                  }
                  right={
                    <Badge
                      label={picked.length ? `${picked.length}/${MAX_ATTACHMENTS}` : "Add"}
                      tone={picked.length ? "primary" : "neutral"}
                      variant={picked.length ? "soft" : "outline"}
                    />
                  }
                  disabled={picked.length >= MAX_ATTACHMENTS}
                  onPress={() => void addScreenshots()}
                  chevron={false}
                />
              </ListGroup>

              {picked.length > 0 ? (
                <Card>
                  <View style={{ gap: spacing.md }}>
                    {picked.map((file, i) => (
                      <View
                        key={`${file.name}-${i}`}
                        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
                      >
                        <PhotoThumb uri={file.uri} width={52} height={52} rounded={radius.sm} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="bodyStrong" numberOfLines={1}>
                            {file.name}
                          </Text>
                          <Text variant="caption" tone="muted">
                            {formatBytes(file.sizeBytes)}
                          </Text>
                        </View>
                        <IconButton
                          icon={X}
                          tone="muted"
                          surface={false}
                          accessibilityLabel={`Remove ${file.name}`}
                          onPress={() => removeScreenshot(i)}
                        />
                      </View>
                    ))}
                  </View>
                </Card>
              ) : null}
            </>
          ) : null}

          <Button
            label={send.isPending ? "Sending" : "Send"}
            icon={Send}
            fullWidth
            disabled={send.isPending}
            onPress={submit}
          />

          <Text variant="caption" tone="muted">
            Your email and the device model go with this, so somebody can reply and reproduce it.
            Only the screenshots you attach are sent - no project photos, documents or notes.
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
