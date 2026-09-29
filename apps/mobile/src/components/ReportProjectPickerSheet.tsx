import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName } from "@everlumen/shared";
import { formatAddress, listProjects, type ProjectListItem } from "@/api/projects";
import { MapPin } from "@/ui/icons";
import { ListGroup, ListRow, RowDivider, Sheet, SkeletonList, Text } from "@/ui";

/**
 * Which job a new report is for.
 *
 * Every report belongs to one project, and the workspace Reports screen is the
 * one place a report can be started without already standing inside a job. So
 * it asks first, with the same list and ordering (most recently touched first)
 * as moving photos between jobs.
 */
export function ReportProjectPickerSheet({
  visible,
  title,
  subtitle,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onPick: (project: ProjectListItem) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: visible,
  });
  const projects = data ?? [];

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      {isLoading ? (
        <SkeletonList rows={5} />
      ) : error ? (
        <Text variant="body" tone="destructive">
          {error instanceof Error ? error.message : "Could not load your projects."}
        </Text>
      ) : projects.length === 0 ? (
        <Text variant="body" tone="muted">
          A report belongs to a project. Create one first.
        </Text>
      ) : (
        <ListGroup>
          {projects.map((project, i) => (
            <View key={project.id}>
              {i === 0 ? null : <RowDivider />}
              <ListRow
                icon={MapPin}
                title={projectDisplayName(project)}
                subtitle={formatAddress(project) ?? undefined}
                onPress={() => onPick(project)}
              />
            </View>
          ))}
        </ListGroup>
      )}
    </Sheet>
  );
}
