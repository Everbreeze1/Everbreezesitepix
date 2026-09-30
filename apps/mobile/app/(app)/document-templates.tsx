import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDocTemplate, listDocTemplates } from "@/api/document-template-admin";
import { groupDocTemplates, isExample } from "@/api/document-template-view";
import { templateNameError } from "@/api/template-edit";
import { GENERAL_CATEGORY, storedCategory } from "@/api/template-library-view";
import { getMyTeam } from "@/api/team";
import { canManageLibrary, errorText, TradeChips } from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import { Archive, FileText, Plus } from "@/ui/icons";
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
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * The document template library: the web's Templates > Documents.
 *
 * Grouped by trade, the team's own templates first within each, then the
 * shared built-in examples. A built-in the company has its own version of is
 * hidden behind that version, so the library holds one card per document.
 * Each opens on `document-template/[id]`, where it is edited in place.
 */
export default function DocumentTemplatesScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftSubtitle, setDraftSubtitle] = useState("");
  const [draftTrade, setDraftTrade] = useState(GENERAL_CATEGORY);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const teamId = teamQuery.data?.team?.id ?? null;
  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);

  // Arriving from the Templates chooser opens the create sheet once.
  const { create: createParam } = useLocalSearchParams<{ create?: string }>();
  const autoOpened = useRef(false);
  useEffect(() => {
    if (createParam !== "1" || !canManage || autoOpened.current) return;
    autoOpened.current = true;
    setCreating(true);
  }, [createParam, canManage]);
  const listQuery = useQuery({
    queryKey: ["doc-templates-admin", teamId],
    queryFn: () => listDocTemplates(teamId),
    enabled: teamQuery.isSuccess || teamQuery.isError,
  });

  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const groups = useMemo(
    () => groupDocTemplates(rows, { showArchived, search }),
    [rows, showArchived, search],
  );
  const archivedCount = rows.filter((r) => r.archived && !isExample(r)).length;

  const create = useMutation({
    mutationFn: () =>
      createDocTemplate({
        name: draftName.trim(),
        description: draftSubtitle,
        category: storedCategory(draftTrade),
        teamId,
      }),
    onSuccess: async (id) => {
      // Refetched before opening: the editor reads its row from this list.
      await queryClient.refetchQueries({ queryKey: ["doc-templates-admin"] });
      setCreating(false);
      setDraftName("");
      setDraftSubtitle("");
      setDraftTrade(GENERAL_CATEGORY);
      router.push({ pathname: "/document-template/[id]", params: { id } });
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

  const loading = teamQuery.isLoading || listQuery.isLoading;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Document templates",
          headerRight: () =>
            canManage ? (
              <IconButton
                icon={Plus}
                accessibilityLabel="New document template"
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
        {loading ? (
          <SkeletonList rows={6} />
        ) : listQuery.error ? (
          <ErrorState
            title="Could not load document templates"
            message={errorText(listQuery.error, "")}
            onRetry={() => void listQuery.refetch()}
          />
        ) : (
          <View style={{ paddingTop: spacing.lg }}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Search documents"
              accessibilityLabel="Search document templates"
            />
            {failure ? (
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                <Text variant="caption" tone="destructive">
                  {failure}
                </Text>
              </View>
            ) : null}

            {groups.length === 0 ? (
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
                <EmptyState
                  icon={FileText}
                  title={rows.length ? "Nothing matches" : "No document templates yet"}
                  body={
                    rows.length
                      ? "Try another search."
                      : "A document template is a page with placeholders that fill in from the project: reports, invoices, handover sheets."
                  }
                  action={
                    canManage && !rows.length
                      ? { label: "New template", onPress: () => setCreating(true), icon: Plus }
                      : undefined
                  }
                />
              </View>
            ) : (
              groups.map((group) => (
                <View key={group.trade}>
                  <SectionHeader title={`${group.trade} (${group.rows.length})`} />
                  <View style={{ paddingHorizontal: spacing.lg }}>
                    <ListGroup>
                      {group.rows.map((row, index) => (
                        <View key={row.id}>
                          {index > 0 ? <RowDivider /> : null}
                          <ListRow
                            icon={FileText}
                            iconTone={row.archived ? "muted" : "primary"}
                            title={row.name}
                            subtitle={row.description ?? undefined}
                            right={
                              row.archived ? (
                                <Badge label="Archived" tone="neutral" variant="outline" />
                              ) : isExample(row) ? (
                                <Badge label="Example" tone="neutral" variant="soft" />
                              ) : undefined
                            }
                            onPress={() =>
                              router.push({
                                pathname: "/document-template/[id]",
                                params: { id: row.id },
                              })
                            }
                          />
                        </View>
                      ))}
                    </ListGroup>
                  </View>
                </View>
              ))
            )}

            <View
              style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md }}
            >
              {archivedCount > 0 ? (
                <Button
                  label={showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
                  icon={Archive}
                  variant="ghost"
                  fullWidth
                  onPress={() => setShowArchived((current) => !current)}
                />
              ) : null}
              <Text variant="caption" tone="muted">
                Examples are shared with every company. Editing one makes your company&apos;s own
                version, which takes its place here; delete yours and the example comes back.
              </Text>
            </View>
          </View>
        )}
      </Screen>

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="New document template"
        subtitle="It starts with a title and three sections you can rewrite."
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
            placeholder="Shown under the title"
            hint="Optional"
          />
          <TradeChips value={draftTrade} onChange={setDraftTrade} />
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
