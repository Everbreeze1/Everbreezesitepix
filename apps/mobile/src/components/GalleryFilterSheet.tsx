import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName } from "@everlumen/shared";
import {
  activeFilterCount,
  dateRangeLabel,
  EMPTY_GALLERY_FILTERS,
  parseCalendarDay,
  presetRange,
  toggleIn,
  type GalleryFilters,
} from "@/api/gallery-filters";
import { listTagNames } from "@/api/photos";
import { listProjects } from "@/api/projects";
import { getMyTeam } from "@/api/team";
import { memberName } from "@/api/team-roster";
import { spacing } from "@/theme";
import { Calendar } from "@/ui/icons";
import { Button, Chip, Field, Sheet, Text } from "@/ui";

/**
 * The Photo Library's filter sheet: the web gallery's filter bar, for a thumb.
 *
 * Project, date range, tags, "Taken by" and needs review, each a section of
 * chips. Edits are a draft until Apply, so flicking through five chips does
 * not refetch the library five times on site data, and Clear all empties the
 * draft without closing, so somebody can start over in one tap.
 *
 * Dates are typed as YYYY-MM-DD with three quick ranges above them. There is no
 * date picker in the dependency set and adding one for this is not worth a
 * native rebuild; most searches are one of the presets anyway.
 */
export function GalleryFilterSheet({
  visible,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  value: GalleryFilters;
  onClose: () => void;
  onApply: (next: GalleryFilters) => void;
}) {
  const [draft, setDraft] = useState<GalleryFilters>(value);
  const [fromText, setFromText] = useState(value.from ?? "");
  const [toText, setToText] = useState(value.to ?? "");

  // Every open starts from what is applied, not from an abandoned draft.
  useEffect(() => {
    if (!visible) return;
    setDraft(value);
    setFromText(value.from ?? "");
    setToText(value.to ?? "");
  }, [visible, value]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: visible,
  });
  const tagsQuery = useQuery({
    queryKey: ["gallery-tags"],
    queryFn: listTagNames,
    enabled: visible,
    staleTime: 10 * 60 * 1000,
  });
  const teamQuery = useQuery({
    queryKey: ["my-team"],
    queryFn: getMyTeam,
    enabled: visible,
    staleTime: 5 * 60 * 1000,
  });

  /*
   * Live jobs first, then the ones already picked even when archived, so a
   * filter set from a link to an archived job can still be seen and removed.
   */
  const projectOptions = useMemo(() => {
    const rows = projectsQuery.data ?? [];
    return rows
      .filter((project) => !project.archived || draft.projectIds.includes(project.id))
      .map((project) => ({ id: project.id, label: projectDisplayName(project) }));
  }, [projectsQuery.data, draft.projectIds]);

  const people = useMemo(
    () =>
      (teamQuery.data?.members ?? [])
        .filter((member) => Boolean(member.user_id))
        .map((member) => ({ id: member.user_id, label: memberName(member) })),
    [teamQuery.data],
  );

  const fromError = fromText.trim() && !parseCalendarDay(fromText) ? "Use YYYY-MM-DD" : undefined;
  const toError = toText.trim() && !parseCalendarDay(toText) ? "Use YYYY-MM-DD" : undefined;
  const reversed =
    !fromError && !toError && fromText.trim() && toText.trim() && fromText.trim() > toText.trim()
      ? "The start is after the end"
      : undefined;

  const withDates = (next: GalleryFilters): GalleryFilters => ({
    ...next,
    from: parseCalendarDay(fromText) ? fromText.trim() : null,
    to: parseCalendarDay(toText) ? toText.trim() : null,
  });

  const count = activeFilterCount(withDates(draft));

  const setRange = (range: { from: string; to: string } | null) => {
    setFromText(range?.from ?? "");
    setToText(range?.to ?? "");
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter photos"
      subtitle={count === 0 ? "Showing every photo" : `${count} filter${count === 1 ? "" : "s"} on`}
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button
            label="Clear all"
            variant="outline"
            disabled={count === 0}
            onPress={() => {
              setDraft(EMPTY_GALLERY_FILTERS);
              setRange(null);
            }}
            style={{ flex: 1 }}
          />
          <Button
            label="Apply"
            disabled={Boolean(fromError || toError || reversed)}
            onPress={() => {
              onApply(withDates(draft));
              onClose();
            }}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <SectionLabel title="Needs review" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <Chip
          label="Only photos with no tags"
          selected={draft.needsReview}
          onPress={() => setDraft({ ...draft, needsReview: !draft.needsReview })}
        />
      </View>

      <SectionLabel title="Date" detail={dateRangeLabel(fromText || null, toText || null)} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <Chip label="Today" onPress={() => setRange(presetRange("today"))} />
        <Chip label="Last 7 days" onPress={() => setRange(presetRange("7d"))} />
        <Chip label="Last 30 days" onPress={() => setRange(presetRange("30d"))} />
        <Chip label="Any time" onPress={() => setRange(null)} />
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Field
          label="From"
          value={fromText}
          onChangeText={setFromText}
          placeholder="YYYY-MM-DD"
          icon={Calendar}
          autoCapitalize="none"
          error={fromError}
          style={{ flex: 1 }}
        />
        <Field
          label="To"
          value={toText}
          onChangeText={setToText}
          placeholder="YYYY-MM-DD"
          icon={Calendar}
          autoCapitalize="none"
          error={toError ?? reversed}
          style={{ flex: 1 }}
        />
      </View>

      <SectionLabel
        title="Projects"
        detail={draft.projectIds.length ? `${draft.projectIds.length} selected` : "Any"}
      />
      <ChipWrap
        options={projectOptions}
        selected={draft.projectIds}
        empty={projectsQuery.isLoading ? "Loading projects" : "No projects yet"}
        onToggle={(id) => setDraft({ ...draft, projectIds: toggleIn(draft.projectIds, id) })}
      />

      <SectionLabel
        title="Tags"
        detail={draft.tags.length ? `${draft.tags.length} selected` : "Any"}
      />
      <ChipWrap
        options={(tagsQuery.data ?? []).map((name) => ({ id: name, label: name }))}
        selected={draft.tags}
        empty={tagsQuery.isLoading ? "Loading tags" : "No tags in this workspace yet"}
        onToggle={(id) => setDraft({ ...draft, tags: toggleIn(draft.tags, id) })}
      />

      {/*
        Only worth a control when more than one person could have taken the
        photo, the same rule the web applies.
      */}
      {people.length > 1 ? (
        <>
          <SectionLabel
            title="Taken by"
            detail={draft.uploaders.length ? `${draft.uploaders.length} selected` : "Anyone"}
          />
          <ChipWrap
            options={people}
            selected={draft.uploaders}
            empty="Nobody else on the team"
            onToggle={(id) => setDraft({ ...draft, uploaders: toggleIn(draft.uploaders, id) })}
          />
        </>
      ) : null}
    </Sheet>
  );
}

function SectionLabel({ title, detail }: { title: string; detail?: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginTop: spacing.sm,
      }}
    >
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      {detail ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

function ChipWrap({
  options,
  selected,
  empty,
  onToggle,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  empty: string;
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) {
    return (
      <Text variant="caption" tone="muted">
        {empty}
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {options.map((option) => (
        <Chip
          key={option.id}
          label={option.label}
          selected={selected.includes(option.id)}
          onPress={() => onToggle(option.id)}
        />
      ))}
    </View>
  );
}
