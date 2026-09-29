import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { displayCaption } from "@everlumen/shared";
import { listProjectPhotoPage } from "@/api/photos";
import type { PickedPhoto } from "@/api/portfolio-showcase";
import { listProjects } from "@/api/projects";
import { spacing, useLayout, useTheme } from "@/theme";
import { Check, ChevronLeft, FolderKanban, Images } from "@/ui/icons";
import {
  Button,
  EmptyState,
  Field,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  PhotoThumb,
  RowDivider,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/** How many of a job's photos the picker loads, newest first. */
const PICKER_PHOTO_LIMIT = 150;

/**
 * Choose photos from a job: the web's `ShowcasePhotoPickerDialog`, for a phone.
 *
 * The web shows the newest 300 photos from every job at once, grouped by job,
 * in a wide dialog. On a phone that is a long scroll of tiny tiles, so this
 * asks the same question in two taps: which job, then which of its photos.
 * It opens on the page's own job when there is one, since that is almost
 * always the answer.
 *
 * `single` is the cover and hero pickers: picking a second photo replaces the
 * first, and "Select all" is hidden because it cannot mean anything there.
 */
export function ShowcasePhotoPicker({
  visible,
  title,
  subtitle,
  single = false,
  initialProjectId = null,
  confirmLabel = "Add",
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  single?: boolean;
  initialProjectId?: string | null;
  confirmLabel?: string;
  onClose: () => void;
  onPick: (photos: PickedPhoto[]) => void;
}) {
  const theme = useTheme();
  const layout = useLayout();
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  // Re-seeded each time it opens, so a cancelled choice does not carry over.
  const [openFor, setOpenFor] = useState(false);
  if (visible !== openFor) {
    setOpenFor(visible);
    if (visible) {
      setProjectId(initialProjectId);
      setSelected([]);
      setQuery("");
    }
  }

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: visible,
  });
  const photosQuery = useQuery({
    queryKey: ["portfolio-picker-photos", projectId],
    queryFn: () => listProjectPhotoPage(projectId!, null, PICKER_PHOTO_LIMIT),
    enabled: visible && Boolean(projectId),
    staleTime: 5 * 60 * 1000,
  });

  const projects = useMemo(() => {
    const all = (projectsQuery.data ?? []).filter((p) => !p.archived);
    const q = query.trim().toLowerCase();
    const matching = q
      ? all.filter((p) =>
          [p.name, p.client_name, p.city].some((v) => (v ?? "").toLowerCase().includes(q)),
        )
      : all;
    // The page's own job first, where there is one.
    return initialProjectId
      ? [...matching].sort(
          (a, b) => Number(b.id === initialProjectId) - Number(a.id === initialProjectId),
        )
      : matching;
  }, [projectsQuery.data, query, initialProjectId]);

  const project = (projectsQuery.data ?? []).find((p) => p.id === projectId) ?? null;
  const photos = photosQuery.data?.photos ?? [];
  const urls = photosQuery.data?.urls ?? {};
  // Three across upright, more when there is room, so tiles stay thumb-sized.
  const columns = Math.max(3, Math.min(6, Math.floor(layout.width / 130)));
  const allSelected = photos.length > 0 && photos.every((p) => selected.includes(p.id));

  const toggle = (id: string) =>
    setSelected((current) => {
      if (single) return current.includes(id) ? [] : [id];
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });

  const confirm = () => {
    const projectName = project?.name ?? "";
    // In the job's own order, so a section reads the way the work went.
    onPick(
      photos
        .filter((p) => selected.includes(p.id))
        .map((p) => ({
          id: p.id,
          imageUrl: urls[p.id] ?? "",
          projectId: projectId ?? "",
          projectName,
        })),
    );
  };

  const footer = projectId ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <IconButton
        icon={ChevronLeft}
        accessibilityLabel="Choose a different job"
        onPress={() => {
          setProjectId(null);
          setSelected([]);
        }}
      />
      <View style={{ flex: 1 }} />
      <Button
        label={
          single
            ? confirmLabel
            : `${confirmLabel}${selected.length ? ` ${selected.length}` : ""} photo${
                selected.length === 1 ? "" : "s"
              }`
        }
        icon={Check}
        disabled={selected.length === 0}
        onPress={confirm}
      />
    </View>
  ) : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={project ? project.name : title}
      subtitle={
        project ? (single ? "Tap the photo to use" : `${selected.length} chosen`) : subtitle
      }
      footer={footer}
      maxHeightRatio={0.92}
    >
      {!projectId ? (
        <>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Search jobs"
            autoCapitalize="none"
          />
          {projectsQuery.isLoading ? (
            <SkeletonList rows={4} />
          ) : projects.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No jobs match" />
          ) : (
            <ListGroup>
              {projects.map((p, index) => (
                <View key={p.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    icon={FolderKanban}
                    title={p.name}
                    subtitle={
                      p.id === initialProjectId
                        ? "This page's job"
                        : (p.client_name ?? p.city ?? undefined)
                    }
                    onPress={() => {
                      setProjectId(p.id);
                      setSelected([]);
                    }}
                  />
                </View>
              ))}
            </ListGroup>
          )}
        </>
      ) : photosQuery.isLoading ? (
        <SkeletonList rows={3} />
      ) : photosQuery.error ? (
        <Text variant="body" tone="destructive">
          {photosQuery.error instanceof Error
            ? photosQuery.error.message
            : "Could not load the photos."}
        </Text>
      ) : photos.length === 0 ? (
        <EmptyState icon={Images} title="No photos on this job yet" />
      ) : (
        <>
          {single ? null : (
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Button
                label={allSelected ? "Clear" : "Select all"}
                size="sm"
                variant="ghost"
                onPress={() => setSelected(allSelected ? [] : photos.map((p) => p.id))}
              />
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {photos.map((photo) => {
              const on = selected.includes(photo.id);
              return (
                <Pressable
                  key={photo.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={displayCaption(photo.caption, "Photo")}
                  onPress={() => toggle(photo.id)}
                  style={{
                    width: `${Math.floor(100 / columns) - 2}%`,
                    aspectRatio: 1,
                  }}
                >
                  <PhotoThumb
                    uri={urls[photo.id]}
                    width="100%"
                    height="100%"
                    style={on ? { borderWidth: 3, borderColor: theme.colors.primary } : undefined}
                  />
                  {on ? (
                    <View
                      style={{
                        position: "absolute",
                        right: 4,
                        top: 4,
                        borderRadius: 999,
                        padding: 2,
                        backgroundColor: theme.colors.primary,
                      }}
                    >
                      <Icon icon={Check} size="sm" tone="inverse" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Sheet>
  );
}
