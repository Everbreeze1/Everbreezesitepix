import { Pressable, View } from "react-native";
import { projectDisplayName, relativeTime } from "@everlumen/shared";
import { formatAddress, type ProjectListItem } from "@/api/projects";
import {
  lastActivityAt,
  photoCountLabel,
  stripOverflow,
  type ProjectCardExtras,
} from "@/api/project-cards-view";
import type { PipelineStage } from "@/api/pipeline-view";
import { LabelChip } from "@/components/ProjectLabels";
import { ProjectCrewAvatars } from "@/components/ProjectCrewAvatars";
import { ProjectStatusPill, projectStatusLabel } from "@/components/ProjectStatusPill";
import { radius, spacing, useTheme } from "@/theme";
import { Archive, Camera, ChevronRight, Clock, Images, MapPin, Star } from "@/ui/icons";
import { PhotoThumb, Text, type LucideIcon } from "@/ui";

/**
 * One job on the Projects tab: web's project card, laid out for a thumb.
 *
 * The owner's note on the first build was that the list was "very simple" for
 * an app about photographs. So the card leads with the job's newest photos,
 * then says what a crew scans a list for: which job, where, what state it is
 * in, how much has been captured, how recently, and who is on it.
 *
 * The whole card is one tap target into the job; the chevron says so. No
 * buttons inside it, because a second target on a card this size is the one a
 * gloved thumb hits by mistake.
 */
export function ProjectListCard({
  project,
  extras,
  stage,
  crew,
  colorOf,
  onPress,
}: {
  project: ProjectListItem;
  /** Undefined while the photo read is in flight: the strip shows placeholders. */
  extras: ProjectCardExtras | undefined;
  stage: PipelineStage | null;
  crew?: { name: string | null; uri: string | null }[];
  colorOf: (label: string) => string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const title = cardTitle(project);
  const address = formatAddress(project);
  const status = stage?.name ?? projectStatusLabel(project.status);
  const done = project.status === "completed";
  const labels = project.labels ?? [];
  const countLabel = photoCountLabel(extras?.count ?? null);
  const activity = relativeTime(lastActivityAt(project.updated_at, extras?.latestAt ?? null));

  const summary = [
    title,
    address,
    project.archived ? "Archived" : status,
    countLabel,
    `last activity ${activity}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary}
      accessibilityHint="Opens the project"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: done ? theme.colors.background : theme.colors.card,
        overflow: "hidden",
        opacity: pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <PhotoStrip extras={extras} />

      <View style={{ padding: spacing.lg, paddingTop: spacing.md, gap: spacing.sm }}>
        {/*
          `minWidth: 0` so a long name wraps against the width it has rather
          than the width it wanted; see `ListRow` for the longer story.
        */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {project.starred ? (
                <Star size={15} color={theme.colors.brand} fill={theme.colors.brand} />
              ) : null}
              <Text
                variant="bodyStrong"
                numberOfLines={2}
                style={{ flexShrink: 1, fontSize: 17, fontWeight: "700", opacity: done ? 0.75 : 1 }}
              >
                {title}
              </Text>
            </View>
            {address ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MapPin size={13} color={theme.colors.mutedForeground} />
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                  {address}
                </Text>
              </View>
            ) : null}
          </View>
          {project.archived ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.secondary,
              }}
            >
              <Archive size={12} color={theme.colors.mutedForeground} />
              <Text variant="caption" tone="muted" style={{ fontWeight: "700" }}>
                Archived
              </Text>
            </View>
          ) : stage ? (
            <StageChip stage={stage} />
          ) : (
            <ProjectStatusPill status={project.status} />
          )}
        </View>

        {labels.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {labels.slice(0, 4).map((name) => (
              <LabelChip key={name} name={name} color={colorOf(name)} size="sm" />
            ))}
            {labels.length > 4 ? (
              <Text variant="caption" tone="muted" style={{ alignSelf: "center" }}>
                {`+${labels.length - 4}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            marginTop: spacing.xs,
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            minHeight: 36,
          }}
        >
          {countLabel ? <Meta icon={Images} text={countLabel} /> : null}
          <Meta icon={Clock} text={activity} />
          <View style={{ flex: 1 }} />
          <ProjectCrewAvatars people={crew} />
          <ChevronRight size={18} color={theme.colors.mutedForeground} />
        </View>
      </View>
    </Pressable>
  );
}

function Meta({ icon: Glyph, text }: { icon: LucideIcon; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
      <Glyph size={14} color={theme.colors.mutedForeground} />
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** A pipeline stage, in the board's own colour, where the job is on one. */
function StageChip({ stage }: { stage: PipelineStage }) {
  const theme = useTheme();
  const color = /^#[0-9a-fA-F]{6}$/.test(stage.color ?? "") ? stage.color : theme.colors.primary;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        maxWidth: 150,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: `${color}${theme.scheme === "dark" ? "40" : "22"}`,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ fontWeight: "700", color: theme.colors.foreground, flexShrink: 1 }}
      >
        {stage.name}
      </Text>
    </View>
  );
}

/**
 * The newest photos, edge to edge across the top of the card.
 *
 * One photo gets the whole strip as a cover. Two to four sit side by side,
 * and when the job holds more than are shown the last tile says how many more,
 * the way the designer's project mockup ends its grid. A job with no photos
 * gets a short prompt rather than an empty frame the height of a photo.
 */
function PhotoStrip({ extras }: { extras: ProjectCardExtras | undefined }) {
  const theme = useTheme();

  if (!extras) {
    return (
      <View style={{ flexDirection: "row", gap: 3, height: 96 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, backgroundColor: theme.colors.secondary }} />
        ))}
      </View>
    );
  }

  const urls = extras.urls;
  if (urls.length === 0) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          height: 52,
          backgroundColor: theme.colors.secondary,
        }}
      >
        <Camera size={16} color={theme.colors.mutedForeground} />
        <Text variant="caption" tone="muted">
          {extras.count === null ? "Photos unavailable" : "No photos yet"}
        </Text>
      </View>
    );
  }

  if (urls.length === 1) {
    return <PhotoThumb uri={urls[0]} height={150} rounded={0} />;
  }

  const more = stripOverflow(extras.count, urls.length);
  return (
    <View style={{ flexDirection: "row", gap: 3, height: 96 }}>
      {urls.map((uri, i) => {
        const last = i === urls.length - 1;
        return (
          <View key={uri} style={{ flex: 1 }}>
            <PhotoThumb uri={uri} height={96} rounded={0} />
            {last && more > 0 ? (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(24, 19, 13, 0.55)",
                }}
              >
                <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "800" }}>
                  {`+${more}`}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** "Client · Street", without repeating the client when the name already is it. */
export function cardTitle(project: ProjectListItem): string {
  const name = projectDisplayName(project);
  const client = project.client_name?.trim();
  if (!client || name.toLowerCase().includes(client.toLowerCase())) return name;
  return `${client} · ${name}`;
}
