import { useMemo, useState, type ReactNode } from "react";
import { FolderPlus, MapPin } from "@/ui/icons";
import { FlatList, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName, relativeTime } from "@everlumen/shared";
import { formatAddress, listProjects } from "@/api/projects";
import { radius, spacing, useTheme } from "@/theme";
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  RowDivider,
  SearchField,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Which job are these photos for?
 *
 * The camera button in the tab bar cannot open the viewfinder directly, because
 * a photo has to be filed against a project and a tab carries no argument. This
 * is that one question, asked once, with the list ordered by `updated_at` so
 * the job someone is standing on is almost always the first row.
 *
 * `router.replace` rather than `push` on the way out. This screen has done its
 * job by then, and leaving it on the stack means backing out of the camera
 * lands on the picker again instead of where the person started.
 */
export default function CaptureStartScreen() {
  const theme = useTheme();
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });

  const projects = useMemo(() => {
    const all = data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((project) => {
      const address = formatAddress(project) ?? "";
      return (
        projectDisplayName(project).toLowerCase().includes(needle) ||
        address.toLowerCase().includes(needle)
      );
    });
  }, [data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.xs }}>
          <Text variant="title">Where do these go?</Text>
          <Text variant="caption" tone="muted">
            Pick the job you are on. Photos upload in the background, so this works with no signal.
          </Text>
        </View>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search projects"
          accessibilityLabel="Search projects"
        />
      </View>

      {isLoading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Failed to load projects"}
          onRetry={() => void refetch()}
        />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            search.trim() ? (
              <EmptyState
                title="No project matches"
                body="Check the spelling, or start a new project for this site."
                action={{
                  label: "New project",
                  icon: FolderPlus,
                  onPress: () => router.replace("/project-new"),
                }}
              />
            ) : (
              <EmptyState
                icon={FolderPlus}
                title="No projects yet"
                body="Photos are filed against a project, so there needs to be one first. It takes a name and nothing else."
                action={{
                  label: "New project",
                  icon: FolderPlus,
                  onPress: () => router.replace("/project-new"),
                }}
              />
            )
          }
          renderItem={({ item, index }) => (
            <ListGroupWrapper first={index === 0} last={index === projects.length - 1}>
              <ListRow
                icon={MapPin}
                title={projectDisplayName(item)}
                subtitle={formatAddress(item) ?? `Updated ${relativeTime(item.updated_at)}`}
                onPress={() => router.replace(`/project/${item.id}/capture`)}
                accessibilityHint="Opens the camera for this project"
              />
              {index === projects.length - 1 ? null : <RowDivider />}
            </ListGroupWrapper>
          )}
          ListFooterComponent={
            projects.length ? (
              <Button
                label="New project instead"
                variant="ghost"
                icon={FolderPlus}
                fullWidth
                onPress={() => router.replace("/project-new")}
                style={{ marginTop: spacing.lg }}
              />
            ) : null
          }
        />
      )}
    </View>
  );
}

/**
 * Rounds the first and last rows so a `FlatList` of rows still reads as one
 * grouped block.
 *
 * `ListGroup` cannot wrap the list itself here: `FlatList` needs to own its
 * children for virtualization, so the group's border is drawn per row and the
 * corners are rounded only at the ends.
 */
function ListGroupWrapper({
  first,
  last,
  children,
}: {
  first: boolean;
  last: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: last ? 1 : 0,
        borderColor: theme.colors.border,
        borderTopLeftRadius: first ? radius.lg : 0,
        borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0,
        borderBottomRightRadius: last ? radius.lg : 0,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}
