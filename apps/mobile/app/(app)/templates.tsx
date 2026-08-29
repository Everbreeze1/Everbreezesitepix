import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can } from "@everlumen/shared/team-permissions";
import { listWorkflowTemplates } from "@/api/templates";
import { createChecklistTemplate, listAllChecklistTemplates } from "@/api/template-admin";
import { templateNameError } from "@/api/template-edit";
import { getMyTeam } from "@/api/team";
import * as WebBrowser from "expo-web-browser";
import { webAppLink } from "@/lib/api";
import { spacing } from "@/theme";
import { Archive, ClipboardCheck, ExternalLink, LayoutTemplate, Plus, Workflow } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
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
 * The shared template library.
 *
 * The fourth and last of the account rows that opened a browser, minus billing,
 * which is parked. What sat behind it is a library the crew starts every
 * checklist from, and being unable to fix a typo in one without finding a
 * laptop is the kind of small friction that has people stop using the library
 * and hand-write the same list instead.
 *
 * **Checklist templates are editable here; the others are not, yet.** Workflow
 * templates are listed read-only because their editor is a second nested list
 * (phases, then items within phases) and shipping half of that is worse than
 * shipping none. Report and walkthrough templates need the rich-text work in
 * Phase 10.1 before an editor makes sense. Both say so rather than being absent,
 * because a missing row reads as a missing feature.
 */
export default function TemplatesScreen() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const checklistsQuery = useQuery({
    queryKey: ["checklist-templates-admin"],
    queryFn: listAllChecklistTemplates,
  });
  const workflowsQuery = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: listWorkflowTemplates,
  });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });

  const canManage = can(teamQuery.data?.myRole, "manage_templates");
  const all = useMemo(() => checklistsQuery.data ?? [], [checklistsQuery.data]);
  const visible = useMemo(
    () => all.filter((template) => (showArchived ? true : !template.archived)),
    [all, showArchived],
  );
  const archivedCount = all.filter((template) => template.archived).length;

  const create = useMutation({
    mutationFn: () =>
      createChecklistTemplate({
        name: draftName.trim(),
        description: draftDescription.trim() || null,
      }),
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: ["checklist-templates-admin"] });
      // Straight into the editor. A template with no items is not useful, and
      // the next thing anybody wants after naming one is to add the first item.
      router.push({ pathname: "/template/[id]", params: { id: template.id } });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not create that template."),
  });

  const submit = useCallback(() => {
    const error = templateNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    setCreating(false);
    setNameError(null);
    create.mutate();
    setDraftName("");
    setDraftDescription("");
  }, [draftName, create]);

  const canOpenWeb = webAppLink("/") !== null;

  async function openTemplatesOnWeb() {
    const url = webAppLink("/templates");
    if (!url) return;
    await WebBrowser.openBrowserAsync(url);
  }

  return (
    <>
      <Stack.Screen options={{ title: "Templates" }} />

      <Screen
        scroll
        padded={false}
        refreshing={checklistsQuery.isRefetching}
        onRefresh={() => void checklistsQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        {checklistsQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : checklistsQuery.error ? (
          <ErrorState
            title="Could not load templates"
            message={
              checklistsQuery.error instanceof Error ? checklistsQuery.error.message : undefined
            }
            onRetry={() => void checklistsQuery.refetch()}
          />
        ) : (
          <>
            {failure ? (
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
                <Text variant="caption" tone="destructive">
                  {failure}
                </Text>
              </View>
            ) : null}

            <SectionHeader title={`Checklists (${visible.length})`} />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              {visible.length === 0 ? (
                <EmptyState
                  icon={ClipboardCheck}
                  title="No checklist templates yet"
                  body="A template is the list a crew works through on every job of a kind. Build it once and start a checklist from it in two taps."
                  action={
                    canManage
                      ? { label: "New template", onPress: () => setCreating(true), icon: Plus }
                      : undefined
                  }
                />
              ) : (
                <ListGroup>
                  {visible.map((template, index) => (
                    <View key={template.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={ClipboardCheck}
                        iconTone={template.archived ? "muted" : "primary"}
                        title={template.name}
                        subtitle={template.description ?? template.category ?? undefined}
                        right={
                          template.archived ? (
                            <Badge label="Archived" tone="neutral" variant="outline" />
                          ) : undefined
                        }
                        onPress={() =>
                          router.push({ pathname: "/template/[id]", params: { id: template.id } })
                        }
                      />
                    </View>
                  ))}
                </ListGroup>
              )}

              {canManage && visible.length > 0 ? (
                <Button
                  label="New template"
                  icon={Plus}
                  variant="secondary"
                  fullWidth
                  disabled={create.isPending}
                  onPress={() => setCreating(true)}
                />
              ) : null}

              {archivedCount > 0 ? (
                <Button
                  label={showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
                  icon={Archive}
                  variant="ghost"
                  fullWidth
                  onPress={() => setShowArchived((current) => !current)}
                />
              ) : null}

              {!canManage ? (
                <Text variant="caption" tone="muted">
                  Only an owner or admin can change the shared library. You can still start a
                  checklist from any of these on a project.
                </Text>
              ) : null}
            </View>

            <SectionHeader title={`Workflows (${workflowsQuery.data?.length ?? 0})`} />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              {(workflowsQuery.data ?? []).length === 0 ? (
                <Text variant="caption" tone="muted">
                  No workflow templates yet.
                </Text>
              ) : (
                <ListGroup>
                  {(workflowsQuery.data ?? []).map((template, index) => (
                    <View key={template.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={Workflow}
                        title={template.name}
                        subtitle={template.description ?? undefined}
                      />
                    </View>
                  ))}
                </ListGroup>
              )}
              {/*
                Said out loud rather than left as a list that does nothing when
                tapped. A row that looks editable and is not is worse than a row
                that says why it is not.
              */}
              <Text variant="caption" tone="muted">
                Workflow templates can be applied to a project from here, and edited on the web for
                now. Their editor is a list of phases each holding its own list, which is a separate
                piece of work.
              </Text>
            </View>

            <SectionHeader title="Report and walkthrough templates" />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                <ListRow
                  icon={LayoutTemplate}
                  title="Edit on the web"
                  subtitle="These are long-form documents, and the phone editor for them is still to come"
                  right={<Badge label="Web" icon={ExternalLink} tone="neutral" variant="outline" />}
                  // Disabled rather than silently doing nothing when no web
                  // origin is configured, which is a build misconfiguration
                  // rather than anything the person did.
                  disabled={!canOpenWeb}
                  onPress={() => void openTemplatesOnWeb()}
                />
              </ListGroup>
            </View>
          </>
        )}
      </Screen>

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="New checklist template"
        subtitle="Name it now and add the items next."
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder="Pre-pour inspection"
            error={nameError ?? undefined}
            autoCapitalize="sentences"
            returnKeyType="next"
          />
          <Field
            label="Description"
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder="What this checklist is for"
            multiline
            rows={3}
          />
          <Button label="Create and add items" icon={Plus} fullWidth onPress={submit} />
        </View>
      </Sheet>
    </>
  );
}
