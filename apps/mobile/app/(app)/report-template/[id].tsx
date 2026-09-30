import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseReportTemplateStructure,
  type ReportSectionLayout,
  type ReportTemplateSection,
  type ReportTemplateStructure,
} from "@everlumen/shared";
import {
  deleteReportTemplate,
  duplicateReportTemplate,
  listReportTemplates,
  setReportTemplateArchived,
  updateReportTemplate,
} from "@/api/report-template-admin";
import {
  cleanPlaceholder,
  COVER_STYLES,
  LAYOUT_OPTIONS,
  layoutLabel,
  newSection,
} from "@/api/report-template-view";
import { swapped } from "@/api/blueprint-library-view";
import { storedCategory, tradeOf } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import {
  canManageLibrary,
  confirmDelete,
  errorText,
  TradeChips,
} from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Copy,
  EllipsisVertical,
  Plus,
  Trash2,
  X,
} from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One report template: name, subtitle, trade, cover, placeholders and the
 * ordered sections. The web's report template editor, one control at a time
 * rather than a three-step wizard.
 *
 * `sections` is one jsonb column, so every structural change writes the whole
 * structure back, in today's shape, the moment it is made. Section bodies are
 * plain text with `{{placeholders}}`, as on the web.
 */
export default function ReportTemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [structure, setStructure] = useState<ReportTemplateStructure | null>(null);
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState<ReportTemplateSection | null>(null);
  const [newPlaceholder, setNewPlaceholder] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["report-templates-admin"],
    queryFn: listReportTemplates,
  });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);
  const teamId = teamQuery.data?.team?.id ?? null;
  const row = useMemo(() => listQuery.data?.find((r) => r.id === id) ?? null, [listQuery.data, id]);

  // Seeded once: the stored shape is parsed a single time, so section ids made
  // up for legacy rows stay put while the list is being edited.
  useEffect(() => {
    if (structure || !row) return;
    setStructure(parseReportTemplateStructure(row.sections));
    setName(row.name);
    setSubtitle(row.subtitle ?? "");
  }, [row, structure]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["report-templates-admin"] });
    void queryClient.invalidateQueries({ queryKey: ["report-templates"] });
    void queryClient.invalidateQueries({ queryKey: ["blueprint-library"] });
  };

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      invalidate();
      setFailure(null);
    },
    onError: (error) => setFailure(errorText(error, "That did not save.")),
  });

  const write = (next: ReportTemplateStructure) => {
    setStructure(next);
    run.mutate(() => updateReportTemplate(id!, { structure: next }));
  };

  const duplicate = useMutation({
    mutationFn: () => duplicateReportTemplate(row!, teamId),
    onSuccess: async (newId) => {
      invalidate();
      await queryClient.refetchQueries({ queryKey: ["report-templates-admin"] });
      router.replace({ pathname: "/report-template/[id]", params: { id: newId } });
    },
    onError: (error) => setFailure(errorText(error, "Could not duplicate that template.")),
  });

  const remover = useMutation({
    mutationFn: () => deleteReportTemplate(id!),
    onSuccess: () => {
      invalidate();
      if (router.canGoBack()) router.back();
      else router.replace("/report-templates");
    },
    onError: (error) => setFailure(errorText(error, "Could not delete that template.")),
  });

  if (listQuery.isLoading || (!row && listQuery.isFetching)) {
    return (
      <>
        <Stack.Screen options={{ title: "Report template" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (listQuery.error || !row || !structure) {
    return (
      <>
        <Stack.Screen options={{ title: "Report template" }} />
        <ErrorState
          title="Could not open this template"
          message={listQuery.error ? errorText(listQuery.error, "") : "It may have been deleted."}
          onRetry={() => void listQuery.refetch()}
        />
      </>
    );
  }

  const items = structure.items;

  const saveSection = (draft: ReportTemplateSection) => {
    const exists = items.some((s) => s.id === draft.id);
    write({
      ...structure,
      items: exists ? items.map((s) => (s.id === draft.id ? draft : s)) : [...items, draft],
    });
    setSection(null);
  };

  const addPlaceholder = () => {
    const value = cleanPlaceholder(newPlaceholder, structure.placeholders);
    setNewPlaceholder("");
    if (value) write({ ...structure, placeholders: [...structure.placeholders, value] });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Report template",
          headerRight: () =>
            canManage ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <IconButton
                  icon={Plus}
                  accessibilityLabel="Add a section"
                  surface={false}
                  tone="primary"
                  onPress={() => setSection(newSection())}
                />
                <IconButton
                  icon={EllipsisVertical}
                  accessibilityLabel="More template actions"
                  surface={false}
                  tone="muted"
                  onPress={() => setMenuOpen(true)}
                />
              </View>
            ) : null,
        }}
      />

      <Screen
        scroll
        padded={false}
        refreshing={listQuery.isRefetching}
        onRefresh={() => void listQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            editable={canManage}
            onBlur={() => {
              const trimmed = name.trim();
              if (!trimmed || trimmed === row.name) return;
              run.mutate(() => updateReportTemplate(id!, { name: trimmed }));
            }}
            returnKeyType="done"
          />
          <Field
            label="Subtitle"
            value={subtitle}
            onChangeText={setSubtitle}
            editable={canManage}
            hint="Optional"
            onBlur={() => {
              const next = subtitle.trim() || null;
              if (next === (row.subtitle ?? null)) return;
              run.mutate(() => updateReportTemplate(id!, { subtitle: next }));
            }}
          />
          {row.archived ? <Badge label="Archived" tone="neutral" variant="outline" /> : null}
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
          <TradeChips
            value={tradeOf(row.category)}
            disabled={!canManage}
            onChange={(trade) =>
              run.mutate(() => updateReportTemplate(id!, { category: storedCategory(trade) }))
            }
          />
        </View>

        <SectionHeader title="Cover" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {COVER_STYLES.map((cover) => (
              <Chip
                key={cover.id}
                label={cover.label}
                selected={structure.coverStyle === cover.id}
                onPress={
                  canManage ? () => write({ ...structure, coverStyle: cover.id }) : undefined
                }
              />
            ))}
          </View>
          <Text variant="caption" tone="muted">
            {COVER_STYLES.find((c) => c.id === structure.coverStyle)?.hint}
          </Text>
        </View>

        <SectionHeader title={`Sections (${items.length})`} />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {items.length === 0 ? (
            <EmptyState
              title="No sections yet"
              body="Each section is a heading, a layout and optional text with placeholders."
              action={
                canManage
                  ? { label: "Add a section", onPress: () => setSection(newSection()), icon: Plus }
                  : undefined
              }
            />
          ) : (
            <ListGroup>
              {items.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    title={item.heading || "Untitled section"}
                    subtitle={[layoutLabel(item.layout), item.body].filter(Boolean).join(" · ")}
                    chevron={false}
                    onPress={canManage ? () => setSection(item) : undefined}
                    right={
                      canManage ? (
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                        >
                          <IconButton
                            icon={ChevronUp}
                            tone="muted"
                            surface={false}
                            accessibilityLabel={`Move ${item.heading} up`}
                            disabled={index === 0}
                            onPress={() =>
                              write({ ...structure, items: [...swapped(items, index, -1)] })
                            }
                          />
                          <IconButton
                            icon={ChevronDown}
                            tone="muted"
                            surface={false}
                            accessibilityLabel={`Move ${item.heading} down`}
                            disabled={index === items.length - 1}
                            onPress={() =>
                              write({ ...structure, items: [...swapped(items, index, 1)] })
                            }
                          />
                          <IconButton
                            icon={Trash2}
                            tone="destructive"
                            surface={false}
                            accessibilityLabel={`Remove ${item.heading}`}
                            onPress={() =>
                              confirmDelete(
                                `Remove "${item.heading || "this section"}"?`,
                                "Reports already made from this template keep it.",
                                "Remove",
                                () =>
                                  write({
                                    ...structure,
                                    items: items.filter((s) => s.id !== item.id),
                                  }),
                              )
                            }
                          />
                        </View>
                      ) : undefined
                    }
                  />
                </View>
              ))}
            </ListGroup>
          )}
        </View>

        <SectionHeader title="Placeholders" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {structure.placeholders.length === 0 ? (
              <Text variant="caption" tone="muted">
                No placeholders yet.
              </Text>
            ) : (
              structure.placeholders.map((p) => (
                <Chip
                  key={p}
                  label={`{{${p}}}`}
                  icon={canManage ? X : undefined}
                  onPress={
                    canManage
                      ? () =>
                          confirmDelete(
                            `Take {{${p}}} off the list?`,
                            "Section text that already uses it keeps the words; it just is not offered any more.",
                            "Remove",
                            () =>
                              write({
                                ...structure,
                                placeholders: structure.placeholders.filter((x) => x !== p),
                              }),
                          )
                      : undefined
                  }
                />
              ))
            )}
          </View>
          {canManage ? (
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Another placeholder"
                  value={newPlaceholder}
                  onChangeText={setNewPlaceholder}
                  placeholder="client_reference"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={addPlaceholder}
                />
              </View>
              <IconButton
                icon={Plus}
                accessibilityLabel="Add placeholder"
                tone="primary"
                disabled={!newPlaceholder.trim()}
                onPress={addPlaceholder}
              />
            </View>
          ) : null}
          <Text variant="caption" tone="muted">
            Tap a placeholder to take it off the list. Section text can use any of them, written
            with double braces.
          </Text>
        </View>
      </Screen>

      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={row.name}
        actions={[
          {
            label: "Duplicate",
            icon: Copy,
            disabled: duplicate.isPending,
            onPress: () => duplicate.mutate(),
          },
          {
            label: row.archived ? "Restore" : "Archive",
            icon: Archive,
            onPress: () => run.mutate(() => setReportTemplateArchived(row.id, !row.archived)),
          },
          {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onPress: () =>
              confirmDelete(
                `Delete "${row.name}"?`,
                "Reports already made from it are untouched. Blueprints using it will show the section as missing. This cannot be undone.",
                "Delete template",
                () => remover.mutate(),
              ),
          },
        ]}
      />

      <SectionSheet draft={section} onClose={() => setSection(null)} onSave={saveSection} />
    </>
  );
}

function SectionSheet({
  draft,
  onClose,
  onSave,
}: {
  draft: ReportTemplateSection | null;
  onClose: () => void;
  onSave: (next: ReportTemplateSection) => void;
}) {
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [layout, setLayout] = useState<ReportSectionLayout>("text");

  useEffect(() => {
    if (!draft) return;
    setHeading(draft.heading);
    setBody(draft.body);
    setLayout(draft.layout);
  }, [draft]);

  return (
    <Sheet visible={draft !== null} onClose={onClose} title="Section">
      <View style={{ gap: spacing.lg }}>
        <Field
          label="Heading"
          value={heading}
          onChangeText={setHeading}
          autoCapitalize="sentences"
        />
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" tone="muted">
            Layout
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {LAYOUT_OPTIONS.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                selected={layout === option.id}
                onPress={() => setLayout(option.id)}
              />
            ))}
          </View>
        </View>
        <Field
          label="Text"
          value={body}
          onChangeText={setBody}
          placeholder="Section body, with {{placeholders}}"
          hint="Optional"
          multiline
          rows={4}
        />
        <Button
          label="Save"
          fullWidth
          onPress={() =>
            draft &&
            onSave({ ...draft, heading: heading.trim() || "Untitled section", body, layout })
          }
        />
      </View>
    </Sheet>
  );
}
