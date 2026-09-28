import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { relativeTime } from "@everlumen/shared";
import { lastActivityAt } from "@/api/project-cards-view";
import {
  cardAddress,
  readableOn,
  stageCountLabel,
  type PipelineStage,
  type StagedProject,
} from "@/api/pipeline-view";
import { ProjectCrewAvatars } from "@/components/ProjectCrewAvatars";
import { radius, spacing, useTheme } from "@/theme";
import { ChevronRight, EllipsisVertical, FolderKanban, Inbox } from "@/ui/icons";
import { Icon, PhotoThumb, Text } from "@/ui";

type Person = { name: string | null; uri: string | null };

/**
 * One column of the pipeline board, the web's `BoardColumn`: a muted tray with
 * the stage's colour along its top edge, its name and count, and the jobs in
 * it as cards that scroll on their own so a stage with forty jobs does not push
 * the other headers away.
 *
 * `stage` is null for the "Not in a pipeline" column, which is deliberately
 * not a stage: it has no colour, and its count is not a stage count.
 */
export function BoardColumn({
  stage,
  title,
  count,
  width,
  height,
  empty,
  isEmpty,
  refreshing,
  onRefresh,
  children,
}: {
  stage: PipelineStage | null;
  title: string;
  count: number;
  width: number;
  height: number;
  /** What an empty column says. */
  empty: string;
  /** Whether there are no cards to draw. */
  isEmpty: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const color = stage?.color ?? theme.colors.border;

  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius.lg,
        backgroundColor: theme.colors.muted,
        borderTopWidth: 4,
        borderTopColor: color,
        overflow: "hidden",
      }}
    >
      <View
        accessibilityRole="header"
        accessibilityLabel={stageCountLabel(title, count)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        {stage ? null : <Icon icon={Inbox} size="xs" tone="muted" />}
        <Text
          variant="overline"
          numberOfLines={1}
          style={{ flex: 1, color: theme.colors.secondaryForeground, fontSize: 12 }}
        >
          {title.toUpperCase()}
        </Text>
        <View
          style={{
            minWidth: 24,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
            borderRadius: radius.pill,
            alignItems: "center",
            backgroundColor: stage ? stage.color : theme.colors.card,
          }}
        >
          <Text
            variant="caption"
            style={{
              fontWeight: "700",
              fontSize: 12,
              color: stage ? readableOn(stage.color) : theme.colors.mutedForeground,
            }}
          >
            {count}
          </Text>
        </View>
      </View>

      <ScrollView
        nestedScrollEnabled
        contentContainerStyle={{ padding: spacing.sm, gap: spacing.sm, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.mutedForeground}
            colors={[theme.colors.primary]}
          />
        }
      >
        {isEmpty ? (
          <View style={{ padding: spacing.lg, alignItems: "center", gap: spacing.sm }}>
            <Icon icon={FolderKanban} size="md" tone="muted" />
            <Text variant="caption" tone="muted" align="center">
              {empty}
            </Text>
          </View>
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One job on the board, the web's `BoardCard`: a 3pt edge in its column's
 * colour, the newest photo, name and address, the crew, when it last moved,
 * and the advance arrow that sends it on to the next stage in one tap.
 *
 * Tapping the card opens the job; the kebab (or a long press) opens the move
 * menu, which reaches any stage including ones scrolled off screen. That is the
 * phone's answer to the web's drag: a drag on a touch screen needs a long
 * press to tell it from a scroll, and the column it is going to is usually not
 * on screen.
 */
export function BoardCard({
  project,
  color,
  thumb,
  latestPhotoAt,
  crew,
  next,
  busy,
  onOpen,
  onMenu,
  onAdvance,
}: {
  project: StagedProject;
  /** The column's colour; absent on the "Not in a pipeline" column. */
  color?: string;
  thumb?: string | null;
  latestPhotoAt?: string | null;
  crew?: Person[];
  /** The stage the advance arrow moves to, or null at the last stage. */
  next: PipelineStage | null;
  busy: boolean;
  onOpen: () => void;
  onMenu: () => void;
  onAdvance: () => void;
}) {
  const theme = useTheme();
  const address = cardAddress(project);
  const activity = project.updated_at
    ? relativeTime(lastActivityAt(project.updated_at, latestPhotoAt ?? null))
    : "";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={project.name}
      accessibilityHint="Opens the project. Long press to move it to another stage."
      onPress={onOpen}
      onLongPress={onMenu}
      style={({ pressed }) => ({
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: color ? 3 : 1,
        borderLeftColor: color ?? theme.colors.border,
        backgroundColor: theme.colors.card,
        padding: spacing.sm,
        gap: spacing.sm,
        opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <PhotoThumb uri={thumb ?? undefined} width={52} height={52} rounded={radius.sm} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 15, lineHeight: 20 }}>
            {project.name}
          </Text>
          {address ? (
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 12 }}>
              {address}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move ${project.name} to another stage`}
          hitSlop={8}
          onPress={onMenu}
          style={({ pressed }) => ({ paddingTop: 2, opacity: pressed ? 0.5 : 1 })}
        >
          <Icon icon={EllipsisVertical} size="sm" tone="muted" />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {crew && crew.length > 0 ? (
          <ProjectCrewAvatars people={crew} size="sm" />
        ) : (
          <Text variant="caption" tone="muted" style={{ fontSize: 12 }}>
            Unassigned
          </Text>
        )}
        <Text
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={{ flex: 1, textAlign: "right", fontSize: 12 }}
        >
          {activity}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            next ? `Move ${project.name} to ${next.name}` : `${project.name} is at the last stage`
          }
          accessibilityState={{ disabled: !next || busy }}
          disabled={!next || busy}
          hitSlop={10}
          onPress={onAdvance}
          style={({ pressed }) => ({
            width: 28,
            height: 28,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.accent : theme.colors.muted,
            opacity: next ? 1 : 0.4,
          })}
        >
          <Icon icon={ChevronRight} size="xs" tone="muted" />
        </Pressable>
      </View>
    </Pressable>
  );
}
