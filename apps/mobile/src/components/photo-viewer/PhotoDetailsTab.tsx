import { useEffect, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { cleanCaption } from "@everlumen/shared";
import { formatCoords, hasCoords, mapsLink } from "@/api/photo-viewer-view";
import { HIT_TARGET, radius, spacing, typography } from "@/theme";
import {
  Calendar,
  Check,
  CircleCheck,
  CircleDashed,
  History,
  Images,
  MapPin,
  Navigation,
  PenLine,
  Plus,
  Sparkles,
  StickyNote,
  Tag,
  User,
  X,
} from "@/ui/icons";
import type { LucideIcon } from "@/ui";
import { TagPill } from "./TagPill";
import { viewerColors as c } from "./viewer-theme";

export type DetailsPhoto = {
  id: string;
  caption: string | null;
  tags: string[];
  phase: string | null;
  taken_at: string | null;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SectionHeader({
  icon: Glyph,
  label,
  action,
}: {
  icon: LucideIcon;
  label: string;
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: spacing.sm,
        minHeight: 28,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Glyph size={14} color={c.muted} />
        <Text style={[typography.overline, { color: c.muted }]}>{label.toUpperCase()}</Text>
      </View>
      {action}
    </View>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.card,
        padding: spacing.md,
      }}
    >
      {children}
    </View>
  );
}

export function SmallButton({
  label,
  icon: Glyph,
  onPress,
  dashed,
  accessibilityLabel,
  primary,
  disabled,
}: {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  dashed?: boolean;
  accessibilityLabel?: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 34,
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderStyle: dashed ? "dashed" : "solid",
        borderColor: primary ? c.primary : c.border,
        backgroundColor: primary ? c.primary : pressed ? c.raised : "transparent",
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {Glyph ? <Glyph size={14} color={primary ? c.primaryForeground : c.muted} /> : null}
      <Text
        style={[
          typography.caption,
          { color: primary ? c.primaryForeground : c.foreground, fontWeight: "600" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const PHASES: { value: "before" | "after" | "untagged"; label: string; icon: LucideIcon }[] = [
  { value: "before", label: "Before", icon: History },
  { value: "after", label: "After", icon: CircleCheck },
  { value: "untagged", label: "None", icon: CircleDashed },
];

/**
 * The Details tab: web's tags and description sections, plus the two things
 * the phone already had that belong with them, before/after and where and when
 * the photo was taken.
 *
 * Voice input: web's panel has a mic that uses the browser's speech API. The
 * app has no speech package and none can be added, so there is no mic button;
 * the keyboard's own dictation key does the same job and the hint says so.
 */
export function PhotoDetailsTab({
  photo,
  projectAddress,
  takenBy,
  onSaveDescription,
  onRemoveTag,
  onOpenTags,
  onSetPhase,
  onAnalyse,
  onInputFocus,
  bottomInset,
}: {
  photo: DetailsPhoto;
  projectAddress: string | null;
  takenBy: string | null;
  onSaveDescription: (next: string | null) => void;
  onRemoveTag: (name: string) => void;
  onOpenTags: () => void;
  onSetPhase: (phase: "before" | "after" | "untagged") => void;
  onAnalyse: () => void;
  onInputFocus?: () => void;
  bottomInset: number;
}) {
  const description = cleanCaption(photo.caption) || null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? "");

  /* Moving to the next photo drops an unsaved edit, as web does. */
  useEffect(() => {
    setEditing(false);
    setDraft(description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  const taken = formatWhen(photo.taken_at ?? photo.created_at);
  const uploaded =
    photo.taken_at && photo.created_at.slice(0, 16) !== photo.taken_at.slice(0, 16)
      ? formatWhen(photo.created_at)
      : null;
  const gps = hasCoords(photo.latitude, photo.longitude);
  const maps = mapsLink(photo.latitude, photo.longitude, projectAddress);
  const phase = photo.phase === "before" || photo.phase === "after" ? photo.phase : "untagged";
  const changed = draft.trim() !== (description ?? "").trim();

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: bottomInset }}
      keyboardShouldPersistTaps="handled"
    >
      <Section>
        <SectionHeader icon={Tag} label="Tags" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {photo.tags.map((tag) => (
            <TagPill key={tag} name={tag} onRemove={() => onRemoveTag(tag)} />
          ))}
          <SmallButton
            label={photo.tags.length === 0 ? "Add tags" : "Add"}
            icon={photo.tags.length === 0 ? Tag : Plus}
            dashed
            onPress={onOpenTags}
            accessibilityLabel={photo.tags.length === 0 ? "Add tags" : "Add or remove tags"}
          />
        </View>
      </Section>

      <Section>
        <SectionHeader
          icon={StickyNote}
          label="Description"
          action={
            !editing ? (
              <SmallButton
                label={description ? "Edit" : "Add"}
                icon={PenLine}
                accessibilityLabel={description ? "Edit description" : "Add a description"}
                onPress={() => {
                  setDraft(description ?? "");
                  setEditing(true);
                }}
              />
            ) : null
          }
        />
        {editing ? (
          <View style={{ gap: spacing.sm }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onFocus={onInputFocus}
              autoFocus
              multiline
              placeholder="Describe what is in this photo: location, issue, next steps"
              placeholderTextColor={c.faint}
              accessibilityLabel="Photo description"
              style={[
                typography.body,
                {
                  color: c.foreground,
                  minHeight: 96,
                  borderWidth: 1,
                  borderColor: c.input,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  textAlignVertical: "top",
                },
              ]}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={[typography.caption, { color: c.faint, flex: 1 }]}>
                Tip: use the keyboard mic to dictate
              </Text>
              <SmallButton
                label="Cancel"
                icon={X}
                onPress={() => {
                  setEditing(false);
                  setDraft(description ?? "");
                }}
              />
              <SmallButton
                label="Save"
                icon={Check}
                primary
                disabled={!changed}
                onPress={() => {
                  onSaveDescription(draft.trim() || null);
                  setEditing(false);
                }}
              />
            </View>
          </View>
        ) : description ? (
          <Text selectable style={[typography.body, { color: c.foreground }]}>
            {description}
          </Text>
        ) : (
          <View
            style={{
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: c.border,
              borderRadius: radius.md,
              padding: spacing.md,
            }}
          >
            <Text style={[typography.caption, { color: c.faint, textAlign: "center" }]}>
              No description yet.
            </Text>
          </View>
        )}
      </Section>

      <Section>
        <SectionHeader icon={Images} label="Before / after" />
        <View
          accessibilityRole="radiogroup"
          style={{
            flexDirection: "row",
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: c.border,
            overflow: "hidden",
          }}
        >
          {PHASES.map((option, index) => {
            const on = phase === option.value;
            const Glyph = option.icon;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Mark as ${option.label}`}
                onPress={() => {
                  if (!on) onSetPhase(option.value);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: HIT_TARGET,
                  flexDirection: "row",
                  gap: 6,
                  alignItems: "center",
                  justifyContent: "center",
                  borderLeftWidth: index === 0 ? 0 : 1,
                  borderLeftColor: c.border,
                  backgroundColor: on ? c.primary : pressed ? c.raised : "transparent",
                })}
              >
                <Glyph size={16} color={on ? c.primaryForeground : c.muted} />
                <Text
                  style={[
                    typography.bodyStrong,
                    { color: on ? c.primaryForeground : c.foreground },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section>
        <SectionHeader icon={Calendar} label="Capture" />
        <View style={{ gap: spacing.sm }}>
          <InfoRow icon={User} label="Taken by" value={takenBy ?? "Unknown"} />
          <InfoRow icon={Calendar} label="Taken" value={taken ?? "Unknown"} />
          {uploaded ? <InfoRow icon={Calendar} label="Uploaded" value={uploaded} /> : null}
          <InfoRow
            icon={MapPin}
            label="Location"
            value={
              gps
                ? formatCoords(photo.latitude as number, photo.longitude as number)
                : "No GPS on this photo"
            }
            tint={gps ? c.success : undefined}
          />
          {maps ? (
            <SmallButton
              label="Open in Maps"
              icon={Navigation}
              accessibilityLabel={
                gps ? "Open photo location in Maps" : "Open project address in Maps"
              }
              onPress={() => void Linking.openURL(maps)}
            />
          ) : null}
        </View>
      </Section>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Analyse this photo with AI"
        accessibilityHint="Reads the equipment plate and looks for visible defects"
        onPress={onAnalyse}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: "rgba(220, 135, 72, 0.4)",
          backgroundColor: pressed ? "rgba(220, 135, 72, 0.22)" : "rgba(220, 135, 72, 0.12)",
          padding: spacing.md,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: c.primary,
          }}
        >
          <Sparkles size={20} color={c.primaryForeground} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[typography.bodyStrong, { color: c.foreground }]}>AI analysis</Text>
          <Text style={[typography.caption, { color: c.muted }]}>
            Read the equipment plate and look for visible defects.
          </Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}

function InfoRow({
  icon: Glyph,
  label,
  value,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Glyph size={14} color={tint ?? c.muted} />
      <Text style={[typography.caption, { color: c.muted, width: 72 }]}>{label}</Text>
      <Text selectable style={[typography.caption, { color: c.foreground, flex: 1 }]}>
        {value}
      </Text>
    </View>
  );
}
