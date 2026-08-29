import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { displayCaption } from "@everlumen/shared";
import { listProjectPhotoPage, signPhotoUrls, type PhotoListItem } from "@/api/photos";
import { describeSiteLogPhotos, getSiteLog, saveSiteLog } from "@/api/site-logs";
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
import { CircleCheck, Images, Plus, Sparkles, X } from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  EmptyState,
  ErrorState,
  Field,
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
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, PhotoNote>>({});
  const [picking, setPicking] = useState(false);
  const [todoDraft, setTodoDraft] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  const save = useMutation({
    mutationFn: (patch: {
      title?: string;
      photo_ids?: string[];
      notes?: Record<string, PhotoNote>;
    }) => saveSiteLog(logId!, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["site-logs", projectId] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not save."),
  });

  const commitNotes = useCallback(
    (next: Record<string, PhotoNote>) => {
      setNotes(next);
      save.mutate({ notes: next });
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
      save.mutate({ photo_ids: next, notes: pruned });
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
      <Stack.Screen options={{ title: title || "Site log" }} />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            // On blur, not per keystroke. A write per character is a write per
            // character on a connection that may be one bar.
            onBlur={() => save.mutate({ title: title.trim() || "Site log" })}
            returnKeyType="done"
          />

          <ButtonRow>
            <Button
              label={chosen.length ? `${chosen.length} photos` : "Choose photos"}
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
                  <Image
                    source={urls[photo.id] ? { uri: urls[photo.id] } : undefined}
                    style={{
                      width: "100%",
                      aspectRatio: 4 / 3,
                      borderRadius: radius.md,
                      backgroundColor: theme.colors.secondary,
                    }}
                    contentFit="cover"
                  />

                  <Field
                    value={note.notes}
                    onChangeText={(text) => setNotes((cur) => withNoteText(cur, photo.id, text))}
                    onBlur={() => save.mutate({ notes })}
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
                <Image
                  source={urls[photo.id] ? { uri: urls[photo.id] } : undefined}
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: radius.sm,
                    backgroundColor: theme.colors.secondary,
                    /*
                      The selected state is a ring, not a tint. A tint over a
                      photograph is invisible against roughly half of them, and
                      a jobsite gallery is mostly grey concrete and bright sky.
                    */
                    borderWidth: on ? 3 : 0,
                    borderColor: theme.colors.primary,
                  }}
                  contentFit="cover"
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
