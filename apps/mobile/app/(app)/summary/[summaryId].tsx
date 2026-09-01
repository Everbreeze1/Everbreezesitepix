import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  deleteSummary,
  getSummary,
  regenerateSummary,
  setSummaryShare,
  summaryShareUrl,
  updateSummary,
} from "@/api/summaries";
import {
  bodyError,
  deleteWarning,
  isNarrated,
  offsetLabel,
  orderedNotes,
  plainBody,
  REGENERATE_WARNING,
  stateMessage,
  summaryOrigin,
  summaryState,
  titleError,
} from "@/api/summary-view";
import { openShareSheet } from "@/api/sharing";
import { radius, spacing, useTheme } from "@/theme";
import {
  Link2,
  NotebookPen,
  PenLine,
  Quote,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  ErrorState,
  Field,
  Icon,
  PhotoThumb,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One walkthrough write-up.
 *
 * The phone could record a walkthrough and had nothing to show for it: the
 * whole summary cluster was unwired, so the artefact the recording exists to
 * produce was reachable only from a desk. This is the read side of it, plus the
 * three things somebody does to one - write it again, fix the title, share it.
 *
 * The shot list is the part worth care. The service keeps what was DONE in a
 * shot separate from what was SAID over it, and says plainly that the
 * distinction is what lets a narrated shot render differently from a silent
 * one. Collapsing them would throw away the thing the recording captured.
 */
export default function SummaryScreen() {
  const { summaryId } = useLocalSearchParams<{ summaryId: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const queryKey = useMemo(() => ["summary", summaryId], [summaryId]);

  const query = useQuery({
    queryKey,
    queryFn: () => getSummary(String(summaryId)),
    enabled: Boolean(summaryId),
    /*
     * A summary being written polls, because the row exists before its body
     * does. Stopped as soon as there is something to read, so a finished
     * write-up is not refetched every ten seconds for as long as it is open.
     */
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      return summaryState(data.summary) === "pending" ? 10_000 : false;
    },
  });

  const summary = query.data?.summary ?? null;
  const photos = query.data?.photos ?? [];
  const state = summary ? summaryState(summary) : "pending";
  const notes = useMemo(() => (summary ? orderedNotes(summary.photoNotes) : []), [summary]);
  const photoById = useMemo(() => new Map(photos.map((p) => [p.photoId, p])), [photos]);

  const rename = useMutation({
    mutationFn: () => updateSummary({ summaryId: String(summaryId), title }),
    onSuccess: () => {
      setEditingTitle(false);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) =>
      setFormError(error instanceof Error ? error.message : "That did not save."),
  });

  const regenerate = useMutation({
    mutationFn: () => regenerateSummary(summary?.walkthroughId ?? ""),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error: unknown) =>
      Alert.alert(
        "Could not write it again",
        error instanceof Error ? error.message : "Please try again.",
      ),
  });

  const share = useMutation({
    mutationFn: (enable: boolean) => setSummaryShare(String(summaryId), enable),
    onSuccess: async (token, enable) => {
      void queryClient.invalidateQueries({ queryKey });
      if (!enable) return;
      const url = summaryShareUrl(token);
      if (!url) {
        Alert.alert(
          "Link created",
          "Sharing is not set up for this workspace, so there is no URL to open.",
        );
        return;
      }
      await openShareSheet(url, summary?.title ?? "Walkthrough summary");
    },
    onError: (error: unknown) =>
      Alert.alert(
        "Could not change the link",
        error instanceof Error ? error.message : "Please try again.",
      ),
  });

  const remove = useMutation({
    mutationFn: () => deleteSummary(String(summaryId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-summaries"] });
      router.back();
    },
    onError: (error: unknown) =>
      Alert.alert("Could not delete", error instanceof Error ? error.message : "Please try again."),
  });

  /**
   * Edit the write-up itself.
   *
   * The body is written by a model and people disagree with models, so the one
   * thing they need is to be able to fix it. Saved as markdown - the phone
   * renders it stripped, and what goes back is what was typed, because
   * round-tripping it through the stripper would silently destroy every heading
   * the model wrote.
   */
  const saveBody = useMutation({
    mutationFn: () => updateSummary({ summaryId: String(summaryId), markdown: editingBody ?? "" }),
    onSuccess: () => {
      setEditingBody(null);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) =>
      setFormError(error instanceof Error ? error.message : "That did not save."),
  });

  const commitBody = useCallback(() => {
    const bad = bodyError(editingBody ?? "");
    if (bad) {
      setFormError(bad);
      return;
    }
    saveBody.mutate();
  }, [editingBody, saveBody]);

  const startRename = useCallback(() => {
    setTitle(summary?.title ?? "");
    setFormError(null);
    setEditingTitle(true);
  }, [summary?.title]);

  const saveRename = useCallback(() => {
    const bad = titleError(title);
    if (bad) {
      setFormError(bad);
      return;
    }
    rename.mutate();
  }, [title, rename]);

  if (query.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Write-up" }} />
        <SkeletonList rows={5} />
      </>
    );
  }

  if (query.error || !summary) {
    return (
      <>
        <Stack.Screen options={{ title: "Write-up" }} />
        <ErrorState
          title="Could not load this write-up"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  const shared = Boolean(summary.shareToken);

  return (
    <>
      {/*
        Constant, not the write-up's own title.

        This was `summary.title`, which the body renders again a few lines
        below - so the name appeared twice, once truncated into the nav bar and
        once in full. It also meant the header flickered: the loading and error
        branches above both say "Write-up", so the bar changed word as the data
        arrived.

        The body is the better of the two places to keep it. A generated title
        like "HVAC Installation & Start-Up Report" is longer than a nav bar,
        which truncates in the middle of the useful part, while the body can
        wrap it and doubles as the tap target for renaming.
      */}
      <Stack.Screen options={{ title: "Write-up" }} />

      <Screen
        scroll
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ gap: spacing.sm }}>
          {editingTitle ? (
            <View style={{ gap: spacing.sm }}>
              <Field
                label="Title"
                value={title}
                onChangeText={(next) => {
                  setTitle(next);
                  if (formError) setFormError(null);
                }}
                error={formError ?? undefined}
              />
              <ButtonRow>
                <Button
                  label="Cancel"
                  variant="secondary"
                  size="sm"
                  onPress={() => setEditingTitle(false)}
                />
                <Button
                  label={rename.isPending ? "Saving" : "Save"}
                  size="sm"
                  disabled={rename.isPending}
                  onPress={saveRename}
                />
              </ButtonRow>
            </View>
          ) : (
            <>
              <Text variant="title">{summary.title}</Text>
              <Text variant="caption" tone="muted">
                {summaryOrigin(summary)} · {relativeTime(summary.updatedAt)}
                {query.data?.projectName ? ` · ${query.data.projectName}` : ""}
              </Text>
            </>
          )}

          {shared ? (
            // Said plainly, because a shared write-up is on the open internet
            // with no login in front of it.
            <Badge label="Link is live" tone="warning" icon={Link2} variant="soft" />
          ) : null}
        </View>

        {stateMessage(state) ? (
          <Card>
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
              <Icon
                icon={state === "failed" ? TriangleAlert : Sparkles}
                size="md"
                tone={state === "failed" ? "safety" : "primary"}
              />
              <Text variant="body" tone="muted" style={{ flex: 1 }}>
                {stateMessage(state)}
              </Text>
            </View>
          </Card>
        ) : null}

        {editingBody !== null ? (
          <>
            <SectionHeader title="Summary" />
            <Field
              value={editingBody}
              onChangeText={(next) => {
                setEditingBody(next);
                if (formError) setFormError(null);
              }}
              multiline
              rows={12}
              error={formError ?? undefined}
              /*
                Markdown, shown as markdown while editing. The reader strips it,
                but hiding the syntax from the person changing it would mean
                their headings vanished the moment they saved.
              */
              hint="Markdown. Headings and lists are kept."
            />
            <ButtonRow>
              <Button
                label="Cancel"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setEditingBody(null);
                  setFormError(null);
                }}
              />
              <Button
                label={saveBody.isPending ? "Saving" : "Save"}
                size="sm"
                disabled={saveBody.isPending}
                onPress={commitBody}
              />
            </ButtonRow>
          </>
        ) : summary.markdown ? (
          <>
            <SectionHeader title="Summary" />
            {/*
              Rendered as plain text. The body is markdown and the phone has no
              renderer for it, so showing the source would put `##` and `**` in
              front of somebody reading a finished document.
            */}
            <Text variant="body">{plainBody(summary.markdown)}</Text>
          </>
        ) : null}

        {notes.length > 0 ? (
          <>
            <SectionHeader title="Photos" count={notes.length} />
            <View style={{ gap: spacing.md }}>
              {notes.map((note) => {
                const photo = photoById.get(note.photoId);
                const time = offsetLabel(note, Boolean(summary.walkthroughId));
                return (
                  <Card key={note.photoId} style={{ gap: spacing.sm }}>
                    <PhotoThumb
                      uri={photo?.imageUrl}
                      width="100%"
                      height={180}
                      contentFit="cover"
                      rounded={radius.sm}
                      showLabel
                    />

                    {time ? (
                      <Text variant="caption" tone="muted">
                        {time} into the walk
                      </Text>
                    ) : null}

                    <Text variant="body">{note.note}</Text>

                    {/*
                      What was SAID, kept apart from what was done. The service
                      is explicit that this distinction is load-bearing, and it
                      is the more valuable half: the model wrote the note, the
                      person on site said this.
                    */}
                    {isNarrated(note) ? (
                      <View
                        style={{
                          flexDirection: "row",
                          gap: spacing.sm,
                          paddingTop: spacing.xs,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border,
                        }}
                      >
                        <Icon icon={Quote} size="sm" tone="primary" />
                        <Text variant="body" tone="muted" style={{ flex: 1 }}>
                          {note.spoken}
                        </Text>
                      </View>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          </>
        ) : null}

        <SectionHeader title="Actions" />
        <View style={{ gap: spacing.sm }}>
          {/*
            The only action here that had no icon, which made it read as the odd
            one out in a stack of four.

            `PenLine` rather than something new: it is already what Rename uses
            on a document folder and on a snippet, so the app has one rename
            icon rather than three. That means the write-up's own body editor
            below gives up `PenLine` and takes `NotebookPen`, which is closer to
            what it does anyway - the Daily Log card already uses that glyph to
            mean "something written up".
          */}
          {!editingTitle ? (
            <Button
              label="Rename"
              icon={PenLine}
              variant="secondary"
              fullWidth
              onPress={startRename}
            />
          ) : null}

          {editingBody === null ? (
            <Button
              label="Edit the write-up"
              icon={NotebookPen}
              variant="secondary"
              fullWidth
              onPress={() => {
                setFormError(null);
                setEditingBody(summary.markdown ?? "");
              }}
            />
          ) : null}

          {/*
            Only offered on a summary that HAS a recording. Regenerating reads
            the original walk, and there is no walk behind a summary written
            from photographs, so the button would be a refusal waiting to happen.
          */}
          {summary.walkthroughId ? (
            <Button
              label={regenerate.isPending ? "Writing it again" : "Write it again"}
              icon={RefreshCw}
              variant="secondary"
              fullWidth
              disabled={regenerate.isPending}
              onPress={() =>
                Alert.alert("Write this again?", REGENERATE_WARNING, [
                  { text: "Keep this one", style: "cancel" },
                  { text: "Write again", onPress: () => regenerate.mutate() },
                ])
              }
            />
          ) : null}

          <Button
            label={shared ? "Stop sharing" : "Share a link"}
            icon={Link2}
            variant="secondary"
            fullWidth
            disabled={share.isPending}
            onPress={() => share.mutate(!shared)}
          />

          <Button
            label="Delete write-up"
            icon={Trash2}
            variant="destructive"
            fullWidth
            disabled={remove.isPending}
            onPress={() =>
              Alert.alert("Delete this write-up?", deleteWarning(summary), [
                { text: "Keep", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => remove.mutate() },
              ])
            }
          />
        </View>
      </Screen>
    </>
  );
}
