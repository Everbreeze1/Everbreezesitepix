import type { ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { HIT_TARGET, radius, spacing, typography } from "@/theme";
import {
  Building2,
  Calendar,
  ExternalLink,
  FolderKanban,
  MapPin,
  MessageSquare,
  SquareCheckBig,
  StickyNote,
} from "@/ui/icons";
import type { LucideIcon } from "@/ui";
import { viewerColors as c } from "./viewer-theme";

export type PanelTab = "details" | "tasks" | "comments";

/**
 * The top of the details panel: which job this photo belongs to, then the tab
 * strip. Web's `PhotoDetailsPanel` header and nav.
 *
 * On a phone this is also the bottom sheet's drag handle, so it is kept short:
 * one line of project, one of address, one of date and GPS, then the tabs.
 */
export function PanelHeader({
  projectName,
  address,
  dateLabel,
  hasGps,
  mapsUrl,
  onOpenProject,
  tab,
  onTab,
  taskCount,
  commentCount,
  grabber,
}: {
  projectName: string;
  address: string | null;
  dateLabel: string | null;
  hasGps: boolean;
  mapsUrl: string | null;
  /** Absent when the viewer was opened from this project's own screen. */
  onOpenProject?: () => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  taskCount: number | null;
  commentCount: number | null;
  /** Draws the sheet's grab bar (phone). */
  grabber?: boolean;
}) {
  return (
    <View style={{ backgroundColor: c.chrome }}>
      {grabber ? (
        <View style={{ alignItems: "center", paddingTop: spacing.sm, paddingBottom: 2 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.faint }} />
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingTop: grabber ? spacing.sm : spacing.lg,
          paddingBottom: spacing.md,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(220, 135, 72, 0.2)",
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <Building2 size={20} color={c.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[typography.bodyStrong, { color: c.foreground }]} numberOfLines={1}>
            {projectName}
          </Text>
          {address ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <MapPin size={12} color={c.muted} />
              <Text style={[typography.caption, { color: c.muted, flex: 1 }]} numberOfLines={1}>
                {address}
              </Text>
            </View>
          ) : null}
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 2 }}
          >
            {dateLabel ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Calendar size={12} color={c.faint} />
                <Text style={[typography.caption, { color: c.faint }]}>{dateLabel}</Text>
              </View>
            ) : null}
            {hasGps ? (
              <View
                accessibilityLabel="This photo has GPS"
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <MapPin size={12} color={c.success} />
                <Text style={[typography.caption, { color: c.faint }]}>GPS</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.xs }}>
          {mapsUrl ? (
            <RoundButton
              icon={ExternalLink}
              label={hasGps ? "Open photo location in Maps" : "Open project address in Maps"}
              onPress={() => void Linking.openURL(mapsUrl)}
            />
          ) : null}
          {onOpenProject ? (
            <RoundButton icon={FolderKanban} label="Open project" onPress={onOpenProject} />
          ) : null}
        </View>
      </View>

      {/*
        Plain toggle buttons rather than a tab role, the same call web makes:
        half-implemented tab semantics promise navigation that is not wired up.
      */}
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          paddingHorizontal: spacing.sm,
        }}
      >
        <TabButton
          icon={StickyNote}
          label="Details"
          count={null}
          active={tab === "details"}
          onPress={() => onTab("details")}
        />
        <TabButton
          icon={SquareCheckBig}
          label="Tasks"
          count={taskCount}
          active={tab === "tasks"}
          onPress={() => onTab("tasks")}
        />
        <TabButton
          icon={MessageSquare}
          label="Comments"
          count={commentCount}
          active={tab === "comments"}
          onPress={() => onTab("comments")}
        />
      </View>
    </View>
  );
}

function RoundButton({
  icon: Glyph,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? c.raised : c.card,
      })}
    >
      <Glyph size={18} color={c.foreground} />
    </Pressable>
  );
}

function TabButton({
  icon: Glyph,
  label,
  count,
  active,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  count: number | null;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count ? `${label}, ${count}` : label}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: HIT_TARGET,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Glyph size={15} color={active ? c.foreground : c.muted} />
      <Text
        style={[typography.caption, { fontWeight: "700", color: active ? c.foreground : c.muted }]}
      >
        {label}
      </Text>
      {count !== null && count > 0 ? (
        <View
          style={{
            borderRadius: radius.pill,
            paddingHorizontal: 6,
            paddingVertical: 1,
            backgroundColor: active ? "rgba(233,228,220,0.16)" : "rgba(233,228,220,0.08)",
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700", color: active ? c.foreground : c.muted }}>
            {count}
          </Text>
        </View>
      ) : null}
      {active ? (
        <View
          style={{
            position: "absolute",
            left: spacing.md,
            right: spacing.md,
            bottom: -1,
            height: 2,
            borderRadius: 1,
            backgroundColor: c.primary,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/**
 * The three tabs' bodies, all mounted, only one shown.
 *
 * Hidden with `display: none` rather than unmounted, as web does: the comments
 * thread holds a live subscription and a half-typed message, and neither should
 * be thrown away because somebody glanced at the tags.
 */
export function PanelBody({
  tab,
  details,
  tasks,
  comments,
}: {
  tab: PanelTab;
  details: ReactNode;
  tasks: ReactNode;
  comments: ReactNode;
}) {
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: c.chrome }}>
      <View style={{ flex: 1, display: tab === "details" ? "flex" : "none" }}>{details}</View>
      <View style={{ flex: 1, display: tab === "tasks" ? "flex" : "none" }}>{tasks}</View>
      <View style={{ flex: 1, display: tab === "comments" ? "flex" : "none" }}>{comments}</View>
    </View>
  );
}
