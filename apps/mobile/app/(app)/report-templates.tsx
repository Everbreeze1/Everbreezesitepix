import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseReportTemplateStructure } from "@everlumen/shared";
import { createReportTemplate, listReportTemplates } from "@/api/report-template-admin";
import { structureSummary, visibleReportTemplates } from "@/api/report-template-view";
import { templateNameError } from "@/api/template-edit";
import { matchesSearch, tradeOf } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import { canManageLibrary, errorText } from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import { Archive, Plus, ScrollText } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SearchField,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Report templates: the web's Templates > Documents > Report templates.
 *
 * A report template is a structure rather than a document: a cover style, the
 * placeholders it offers, and an ordered list of sections, each with a layout.
 * A report built from one is assembled from the project's own photos,
 * checklists and workflow. Each opens on `report-template/[id]`.
 */
export default function ReportTemplatesScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftSubtitle, setDraftSubtitle] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["report-templates-admin"],
    queryFn: listReportTemplates,
  });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);

  // Arriving from the Templates chooser opens the create sheet once.
  const { create: createParam } = useLocalSearchParams<{ create?: string }>();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (createParam !== "1" || !canManage || autoOpened.current) return;
    autoOpened.current = true;
    setCreating(true);
  }, [createParam, canManage]);
  const teamId = teamQuery.data?.team?.id ?? null;

  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const visible = useMemo(
    () =>
      visibleReportTemplates(rows, showArchived).filter((r) =>
        matchesSearch(search, r.name, r.subtitle, r.category),
      ),
    [rows, showArchived, search],
  );
  const archivedCount = rows.filter((r) => r.archived).length;

  const create = useMutation({
    mutationFn: () =>
      createReportTemplate({
        name: draftName.trim(),
        subtitle: draftSubtitle.trim() || null,
        teamId,
      }),
    onSuccess: async (id) => {
      await queryClient.refetchQueries({ queryKey: ["report-templates-admin"] });
      void queryClient.invalidateQueries({ queryKey: ["report-templates"] });
      setCreating(false);
      setDraftName("");
      setDraftSubtitle("");
      router.push({ pathname: "/report-template/[id]", params: { id } });
    },
    onError: (error) => setFailure(errorText(error, "Could not create that template.")),
  });

  const submit = () => {
    const error = templateNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    setNameError(null);
    create.mutate();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Report templates",
          headerRight: () =>
            canManage ? (
              <IconButton
                icon={Plus}
                accessibilityLabel="New report template"
                surface={false}
                tone="primary"
                disabled={create.isPending}
                onPress={() => setCreating(true)}
              />
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
        {listQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : listQuery.error ? (
          <ErrorState
            title="Could not load report templates"
            message={errorText(listQuery.error, "")}
            onRetry={() => void listQuery.refetch()}
          />
        ) : (
          <View style={{ paddingTop: spacing.lg, gap: spacing.md }}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search report templates"
              accessibilityLabel="Search report templates"
            />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              {failure ? (
                <Text variant="caption" tone="destructive">
                  {failure}
                </Text>
              ) : null}
              {visible.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  title={rows.length ? "Nothing matches" : "No report templates yet"}
                  body={
                    rows.length
                      ? "Try another search."
                      : "A reusable report structure: cover style, sections and placeholders, applied to any project."
                  }
                  action={
                    canManage && !rows.length
                      ? { label: "New template", onPress: () => setCreating(true), icon: Plus }
                      : undefined
                  }
                />
              ) : (
                <ListGroup>
                  {visible.map((row, index) => (
                    <View key={row.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={ScrollText}
                        iconTone={row.archived ? "muted" : "primary"}
                        title={row.name}
                        subtitle={[
                          tradeOf(row.category),
                          structureSummary(parseReportTemplateStructure(row.sections)),
                        ].join(" · ")}
                        right={
                          row.archived ? (
                            <Badge label="Archived" tone="neutral" variant="outline" />
                          ) : undefined
                        }
                        onPress={() =>
                          router.push({ pathname: "/report-template/[id]", params: { id: row.id } })
                        }
                      />
                    </View>
                  ))}
                </ListGroup>
              )}
              {archivedCount > 0 ? (
                <Button
                  label={showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
                  icon={Archive}
                  variant="ghost"
                  fullWidth
                  onPress={() => setShowArchived((current) => !current)}
                />
              ) : null}
            </View>
          </View>
        )}
      </Screen>

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="New report template"
        subtitle="It starts with four sections you can rename, reorder or remove."
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder="Site visit report"
            error={nameError ?? undefined}
            autoCapitalize="sentences"
          />
          <Field
            label="Subtitle"
            value={draftSubtitle}
            onChangeText={setDraftSubtitle}
            hint="Optional"
          />
          <Button
            label="Save and edit"
            icon={Plus}
            fullWidth
            loading={create.isPending}
            onPress={submit}
          />
        </View>
      </Sheet>
    </>
  );
}
