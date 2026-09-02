import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { displayCaption, readableErrorMessage } from "@everlumen/shared";
import { listProjectPhotoPage, signPhotoUrls, type PhotoListItem } from "@/api/photos";
import { describeSiteLogPhotos, exportSiteLogPdf, getSiteLog } from "@/api/site-logs";
import type { SiteLogRow } from "@/api/site-log-notes";
import { enqueue } from "@/offline/outbox";
import { requestSync } from "@/offline/sync";
import { siteLogPatchRowId, type SiteLogPatchPayload } from "@/offline/handlers";
import {
  mergeDescriptions,
  noteFor,
  photoIdsOf,
  pruneNotes,
  withNoteText,
  withTodoAdded,
  withTodoRemoved,
  withTodoToggled,
  type PhotoNote,
} from "@/api/site-log-notes";
import { radius, spacing, useTheme } from "@/theme";
import { CircleCheck, FileText, Images, Plus, Sparkles, X } from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  EmptyState,
  ErrorState,
  Field,
  PhotoThumb,
  IconButton,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One site log: pick the photos, write against each, list what is still to do.
 *
 * The awkward part of this screen is not the editing, it is when to save. A
 * phone loses focus constantly (a call, the camera, the screen locking) and a
 * log that only saved on a button would lose an afternoon of notes to a
 * notification. So every field commits on blur, which is the same rule the
 * checklist runner uses, and the same reason.
 *
 * Notes are held in local state between commits rather than round-tripping
 * through the query cache per keystroke: typing has to stay at typing speed
 * with twelve photos on screen.
 */
export default function SiteLogScreen() {
  const { logId, projectId } = useLocalSearchParams<{ logId: string; projectId?: string }>();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, PhotoNote>>({});
  const [picking, setPicking] = useState(false);
  const [todoDraft, setTodoDraft] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  /*
   * The title as it stands right now, and the last value actually written.
   *
   * Read by the unmount effect below, which cannot see state through its own
   * closure. Refs rather than state because nothing renders from them.
   */
  const titleRef = useRef("");
  const savedTitleRef = useRef("");
  const saveRef = useRef<((field: string, patch: { title?: string }) => void) | null>(null);

  const queryKey = useMemo(() => ["site-log", logId], [logId]);

  const query = useQuery({
    queryKey,
    queryFn: () => getSiteLog(logId!),
    enabled: Boolean(logId),
  });

  /*
   * Seed local state once, from the server row.
   *
   * Re-seeding on every refetch would throw away whatever is half-typed the
   * moment a background refresh lands, which on a phone is whenever the app
   * comes back to the foreground.
   */
  useEffect(() => {
    if (loaded || !query.data) return;
    setTitle(query.data.title);
    titleRef.current = query.data.title;
    savedTitleRef.current = query.data.title;
    setPhotoIds(photoIdsOf(query.data));
    setNotes(query.data.notes ?? {});
    setLoaded(true);
  }, [query.data, loaded]);

  /** Every photo on the project, so the picker has something to offer. */
  const photosQuery = useQuery({
    queryKey: ["site-log-photos", projectId],
    queryFn: async () => {
      const page = await listProjectPhotoPage(projectId!, null);
      return page;
    },
    enabled: Boolean(projectId),
  });

  /*
   * Its own memo, not a `?? []` inline.
   *
   * A fresh array literal per render changes the identity of every dependency
   * list it appears in, which re-derives `chosen` on every keystroke in every
   * note field on the screen.
   */
  const allPhotos: PhotoListItem[] = useMemo(
    () => photosQuery.data?.photos ?? [],
    [photosQuery.data],
  );
  const chosen = useMemo(
    () =>
      photoIds
        .map((id) => allPhotos.find((p) => p.id === id))
        .filter((p): p is PhotoListItem => Boolean(p)),
    [photoIds, allPhotos],
  );

  /*
   * URLs for the chosen photos specifically. The page's own signed URLs cover
   * only the first page, and a log often includes something older.
   */
  const urlsQuery = useQuery({
    queryKey: ["site-log-urls", logId, photoIds.join(",")],
    queryFn: () => signPhotoUrls(chosen),
    enabled: chosen.length > 0,
    staleTime: 45 * 60 * 1000,
  });
  const urls = { ...(photosQuery.data?.urls ?? {}), ...(urlsQuery.data ?? {}) };

  /**
   * Save through the outbox rather than straight to the server.
   *
   * A site log is written on the job, and the job is where there is no signal.
   * This used to be a direct RLS write: with the radio off it failed, said "that
   * did not save", and the day's notes lived only in the screen's own state
   * until somebody navigated away.
   *
   * `field` keys the queue row, exactly as the project patch does, so retyping
   * a title replaces its own row while a note added to a photograph queues
   * separately and both still land.
   */
  const save = useCallback(
    async (
      field: string,
      patch: { title?: string; photo_ids?: string[]; notes?: Record<string, PhotoNote> },
    ) => {
      if (!logId) return;
      setFailure(null);

      // Optimistic, so the list behind this screen agrees with what is on it
      // before the queue drains.
      queryClient.setQueryData<SiteLogRow[]>(["site-logs", projectId], (current) =>
        (current ?? []).map((row) => (row.id === logId ? { ...row, ...patch } : row)),
      );

      try {
        await enqueue({
          id: siteLogPatchRowId(field, logId),
          kind: "site_log_patch",
          projectId: projectId ?? null,
          payload: { logId, patch } satisfies SiteLogPatchPayload,
        });
        requestSync();
      } catch (error) {
        // Failing to QUEUE is the only failure worth reporting now: it means
        // the local database is unavailable, and the note really is not kept.
        setFailure(error instanceof Error ? error.message : "That could not be saved.");
      }
    },
    [logId, projectId, queryClient],
  );

  /*
   * Commit a half-typed title when the screen goes away.
   *
   * The field writes `onBlur`, which is right - a write per keystroke is a
   * write per keystroke on a connection that may be one bar. But the header
   * back button unmounts this screen without ever blurring the input, so
   * somebody who renamed a log and tapped back lost the rename, silently and
   * with no way to tell it had happened.
   *
   * That is a bad way to lose it. The edit is queued through the outbox
   * precisely so it survives having no signal on site, and it was being thrown
   * away by a back tap instead.
   *
   * Guarded on the value actually differing from the last one written, so
   * leaving a screen nobody typed on queues nothing.
   */
  useEffect(() => {
    saveRef.current = save as (field: string, patch: { title?: string }) => void;
  }, [save]);

  useEffect(() => {
    return () => {
      const pending = titleRef.current.trim() || "Site log";
      if (pending === savedTitleRef.current) return;
      savedTitleRef.current = pending;
      saveRef.current?.("title", { title: pending });
    };
  }, []);

  const commitNotes = useCallback(
    (next: Record<string, PhotoNote>) => {
      setNotes(next);
      void save("notes", { notes: next });
    },
    [save],
  );

  const setPhotos = useCallback(
    (next: string[]) => {
      setPhotoIds(next);
      // Prune in the same write. Leaving orphaned notes behind resurrects a
      // deleted note if the photo is added back, and grows the jsonb forever.
      const pruned = pruneNotes(notes, next);
      setNotes(pruned);
      void save("photos", { photo_ids: next, notes: pruned });
    },
    [notes, save],
  );

  const describe = useMutation({
    mutationFn: async () => {
      const result = await describeSiteLogPhotos(photoIds);
      return result.notes;
    },
    onSuccess: (described) => {
      /*
       * Merged, never replaced. Somebody who wrote three careful lines and then
       * tapped Describe to fill in the rest must not lose them.
       */
      const merged = mergeDescriptions(notes, described, photoIds);
      commitNotes(merged);
    },
    onError: (error: unknown) =>
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not write the descriptions. The model may be unreachable from this network.",
      ),
  });

  const exportPdf = useMutation({
    mutationFn: async () => {
      /*
       * Built from the notes in local state rather than from the query cache.
       * Notes commit on blur, so the line somebody is typing right now has not
       * reached the server yet - and exporting a PDF that is missing the
       * sentence still under the cursor is exactly the kind of quiet wrongness
       * nobody reports as a bug, they just stop trusting the export.
       */
      const items = photoIds.map((photoId) => {
        const note = noteFor(notes, photoId);
        return {
          photoId,
          notes: note.notes,
          todos: note.todos.map((t) => ({ text: t.text, done: t.done })),
        };
      });
      return exportSiteLogPdf({
        projectId: projectId ?? query.data!.project_id,
        title: title.trim() || "Site log",
        items,
      });
    },
    onSuccess: async (result) => {
      /*
       * The Documents tab is keyed `["document-tree", projectId]`, not
       * `["project-documents"]` - invalidating the wrong key is a silent no-op,
       * and the export would look like it had not filed anything until the
       * person left the project and came back.
       */
      const project = projectId ?? query.data?.project_id;
      if (project) await queryClient.invalidateQueries({ queryKey: ["document-tree", project] });
      await WebBrowser.openBrowserAsync(result.url);
    },
    onError: (error: unknown) =>
      setFailure(readableErrorMessage(error, "Could not export this log as a PDF.")),
  });

  if (query.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Site log" }} />
        <SkeletonList rows={5} />
      </>
    );
  }

  if (query.error || !query.data) {
    return (
      <>
        <Stack.Screen options={{ title: "Site log" }} />
        <ErrorState
          title="Could not load this log"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  return (
    <>
      {/*
        "Site log", not the record's own name: it is already in the Title field
        below, the nav bar truncates it to a prefix that identifies nothing, and
        reading the live field state renamed the screen on every keystroke. The
        loading and error states above always said "Site log"; only this one
        disagreed.
      */}
      <Stack.Screen options={{ title: "Site log" }} />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Field
            label="Title"
            value={title}
            onChangeText={(next) => {
              setTitle(next);
              titleRef.current = next;
            }}
            // On blur, not per keystroke. A write per character is a write per
            // character on a connection that may be one bar.
            onBlur={() => {
              const next = title.trim() || "Site log";
              savedTitleRef.current = next;
              void save("title", { title: next });
            }}
            returnKeyType="done"
          />

          <ButtonRow>
            <Button
              label={
                chosen.length
                  ? `${chosen.length} photo${chosen.length === 1 ? "" : "s"}`
                  : "Choose photos"
              }
              icon={Images}
              variant="secondary"
              onPress={() => setPicking(true)}
            />
            <Button
              label={describe.isPending ? "Writing" : "Describe"}
              icon={Sparkles}
              disabled={describe.isPending || photoIds.length === 0}
              onPress={() => describe.mutate()}
            />
          </ButtonRow>

          <Button
            label={exportPdf.isPending ? "Building the PDF" : "Export as PDF"}
            icon={FileText}
            variant="secondary"
            disabled={exportPdf.isPending || photoIds.length === 0}
            onPress={() => exportPdf.mutate()}
          />
          {photoIds.length ? (
            <Text variant="caption" tone="muted">
              Saved to this job's Documents, then opened. A phone has no downloads folder, so filing
              it is what makes it findable tomorrow.
            </Text>
          ) : null}

          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
        </View>

        {chosen.length === 0 ? (
          <EmptyState
            icon={Images}
            title="No photos on this log yet"
            body="Choose the ones worth writing up. Describe then drafts a line against each, which you can edit."
            action={{ label: "Choose photos", onPress: () => setPicking(true), icon: Plus }}
          />
        ) : (
          chosen.map((photo, index) => {
            const note = noteFor(notes, photo.id);
            return (
              <View key={photo.id}>
                <SectionHeader title={`${index + 1}. ${displayCaption(photo.caption, "Photo")}`} />
                <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
                  <PhotoThumb
                    uri={urls[photo.id]}
                    width="100%"
                    aspectRatio={4 / 3}
                    rounded={radius.md}
                    showLabel
                  />

                  <Field
                    value={note.notes}
                    onChangeText={(text) => setNotes((cur) => withNoteText(cur, photo.id, text))}
                    onBlur={() => void save("notes", { notes })}
                    placeholder="What this photo shows"
                    multiline
                    rows={3}
                  />

                  {note.todos.map((todo) => (
                    <View
                      key={todo.id}
                      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
                    >
                      <IconButton
                        icon={CircleCheck}
                        tone={todo.done ? "success" : "muted"}
                        surface={false}
                        accessibilityLabel={todo.done ? "Mark not done" : "Mark done"}
                        onPress={() => commitNotes(withTodoToggled(notes, photo.id, todo.id))}
                      />
                      <Text
                        variant="body"
                        tone={todo.done ? "muted" : "default"}
                        style={{
                          flex: 1,
                          // Struck through rather than moved or hidden: a to-do
                          // that vanishes when ticked cannot be un-ticked by
                          // somebody who tapped the wrong row.
                          textDecorationLine: todo.done ? "line-through" : "none",
                        }}
                      >
                        {todo.text}
                      </Text>
                      <IconButton
                        icon={X}
                        tone="muted"
                        surface={false}
                        accessibilityLabel="Remove this to-do"
                        onPress={() => commitNotes(withTodoRemoved(notes, photo.id, todo.id))}
                      />
                    </View>
                  ))}

                  <Field
                    value={todoDraft[photo.id] ?? ""}
                    onChangeText={(text) => setTodoDraft((cur) => ({ ...cur, [photo.id]: text }))}
                    placeholder="Add something to do"
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      const text = todoDraft[photo.id] ?? "";
                      if (!text.trim()) return;
                      commitNotes(
                        withTodoAdded(
                          notes,
                          photo.id,
                          text,
                          // Device-minted, so the same to-do added twice offline
                          // cannot collide with one added on another phone.
                          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                        ),
                      );
                      setTodoDraft((cur) => ({ ...cur, [photo.id]: "" }));
                    }}
                  />
                </View>
              </View>
            );
          })
        )}
      </Screen>

      <PhotoPicker
        visible={picking}
        photos={allPhotos}
        urls={urls}
        chosen={photoIds}
        loading={photosQuery.isLoading}
        onClose={() => setPicking(false)}
        onDone={(next) => {
          setPicking(false);
          setPhotos(next);
        }}
      />
    </>
  );
}

/**
 * Choosing which photos the log covers.
 *
 * A grid rather than a list, because the question is "which of these did I
 * take" and a caption answers that far less well than the picture does.
 */
function PhotoPicker({
  visible,
  photos,
  urls,
  chosen,
  loading,
  onClose,
  onDone,
}: {
  visible: boolean;
  photos: PhotoListItem[];
  urls: Record<string, string>;
  chosen: string[];
  loading: boolean;
  onClose: () => void;
  onDone: (next: string[]) => void;
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState<Set<string>>(new Set(chosen));

  // Re-seed when it opens, so a cancelled selection does not persist.
  const [seenFor, setSeenFor] = useState<string>("");
  const key = chosen.join(",");
  if (visible && seenFor !== key) {
    setSeenFor(key);
    setSelected(new Set(chosen));
  }

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Photos on this log"
      subtitle={`${selected.size} chosen`}
      footer={
        <Button
          label="Use these"
          fullWidth
          // Filtered through the project's own order rather than selection
          // order, so the log reads chronologically like the gallery does.
          onPress={() => onDone(photos.filter((p) => selected.has(p.id)).map((p) => p.id))}
        />
      }
    >
      {loading ? (
        <SkeletonList rows={3} />
      ) : photos.length === 0 ? (
        <EmptyState icon={Images} title="No photos on this project yet" />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {photos.map((photo) => {
            const on = selected.has(photo.id);
            return (
              <Pressable
                key={photo.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={displayCaption(photo.caption, "Photo")}
                onPress={() => toggle(photo.id)}
                style={{ width: "31.5%", aspectRatio: 1 }}
              >
                <PhotoThumb
                  uri={urls[photo.id]}
                  width="100%"
                  height="100%"
                  /*
                    The selected state is a ring, not a tint. A tint over a
                    photograph is invisible against roughly half of them, and
                    a jobsite gallery is mostly grey concrete and bright sky.
                  */
                  style={on ? { borderWidth: 3, borderColor: theme.colors.primary } : undefined}
                />
                {on ? (
                  <View style={{ position: "absolute", right: 4, bottom: 4 }}>
                    <Badge label="On" tone="primary" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}
