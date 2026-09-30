import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChecklistTemplate, listAllChecklistTemplates } from "@/api/template-admin";
import { templateNameError } from "@/api/template-edit";
import {
  createWorkflowTemplate,
  deleteWorkflowTemplate,
  duplicateWorkflowTemplate,
  listAllWorkflowTemplates,
  setWorkflowTemplateArchived,
  updateWorkflowTemplate,
  type WorkflowTemplateRow,
} from "@/api/workflow-template-admin";
import { getMyTeam } from "@/api/team";
import { canManageLibrary, confirmDelete, errorText } from "@/components/TemplateLibraryParts";
import { spacing } from "@/theme";
import {
  Archive,
  ClipboardCheck,
  Copy,
  EllipsisVertical,
  FileText,
  Footprints,
  LayoutTemplate,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  Workflow,
} from "@/ui/icons";
import {
  ActionSheet,
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
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

type Draft = { kind: "checklist" | "workflow"; editing: WorkflowTemplateRow | null };

/** The libraries with a screen of their own, in the web's tab order. */
const LIBRARIES: {
  title: string;
  subtitle: string;
  icon: typeof LayoutTemplate;
  href: Href;
  create: Href;
}[] = [
  {
    title: "Blueprints",
    subtitle: "Bundles that set a whole job up in one go",
    icon: LayoutTemplate,
    href: "/blueprints",
    create: { pathname: "/blueprints", params: { create: "1" } },
  },
  {
    title: "Documents",
    subtitle: "Pages with placeholders that fill in from the project",
    icon: FileText,
    href: "/document-templates",
    create: { pathname: "/document-templates", params: { create: "1" } },
  },
  {
    title: "Report templates",
    subtitle: "Cover, sections and layouts a report is assembled from",
    icon: ScrollText,
    href: "/report-templates",
    create: { pathname: "/report-templates", params: { create: "1" } },
  },
  {
    title: "Walkthroughs",
    subtitle: "Shot lists the crew works through on site",
    icon: Footprints,
    href: "/walkthrough-templates",
    create: { pathname: "/walkthrough-templates", params: { create: "1" } },
  },
];

/**
 * The shared template library: the web's Templates page.
 *
 * Checklists and workflows are listed here directly, because they are the two
 * a crew starts from most. Blueprints, documents, report templates and
 * walkthroughs each have a screen of their own, reached from the top of this
 * one. Nothing here sends anyone to a browser any more: every library the web
 * manages can be created, edited, duplicated and deleted on the phone.
 */
export default function TemplatesScreen() {
  const queryClient = useQueryClient();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showArchivedWorkflows, setShowArchivedWorkflows] = useState(false);
  const [workflowMenu, setWorkflowMenu] = useState<WorkflowTemplateRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const checklistsQuery = useQuery({
    queryKey: ["checklist-templates-admin"],
    queryFn: listAllChecklistTemplates,
  });
  const workflowsQuery = useQuery({
    queryKey: ["workflow-templates-admin"],
    queryFn: listAllWorkflowTemplates,
  });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });

  const canManage = canManageLibrary(teamQuery.data?.myRole, teamQuery.isSuccess);
  const all = useMemo(() => checklistsQuery.data ?? [], [checklistsQuery.data]);
  const visible = useMemo(
    () => all.filter((template) => (showArchived ? true : !template.archived)),
    [all, showArchived],
  );
  const archivedCount = all.filter((template) => template.archived).length;
  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data]);
  const visibleWorkflows = workflows.filter((w) => showArchivedWorkflows || !w.archived);
  const archivedWorkflows = workflows.filter((w) => w.archived).length;

  const refreshWorkflows = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["workflow-templates-admin"] });
    // The project Workflows tab reads the live list under this key.
    void queryClient.invalidateQueries({ queryKey: ["workflow-templates"] });
    void queryClient.invalidateQueries({ queryKey: ["blueprint-library"] });
  }, [queryClient]);

  const openDraft = (next: Draft) => {
    setDraftName(next.editing?.name ?? "");
    setDraftDescription(next.editing?.description ?? "");
    setNameError(null);
    setDraft(next);
  };

  const save = useMutation({
    mutationFn: async (target: Draft) => {
      const name = draftName.trim();
      const description = draftDescription.trim() || null;
      if (target.kind === "checklist") {
        const created = await createChecklistTemplate({ name, description });
        return { kind: target.kind, id: created.id, name };
      }
      if (target.editing) {
        await updateWorkflowTemplate(target.editing.id, { name, description });
        return { kind: target.kind, id: null, name };
      }
      return { kind: target.kind, id: await createWorkflowTemplate({ name, description }), name };
    },
    onSuccess: (result) => {
      setDraft(null);
      setDraftName("");
      setDraftDescription("");
      setFailure(null);
      if (result.kind === "checklist") {
        void queryClient.invalidateQueries({ queryKey: ["checklist-templates-admin"] });
        // Straight into the editor: the next thing anybody wants is the first item.
        router.push({ pathname: "/template/[id]", params: { id: result.id } });
        return;
      }
      refreshWorkflows();
      if (result.id) {
        router.push({
          pathname: "/workflow-template/[templateId]",
          params: { templateId: result.id, name: result.name },
        });
      }
    },
    onError: (error: unknown) => setFailure(errorText(error, "Could not save that template.")),
  });

  const workflowAction = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      refreshWorkflows();
      setFailure(null);
    },
    onError: (error) => {
      refreshWorkflows();
      setFailure(errorText(error, "That did not save."));
    },
  });

  const submit = useCallback(() => {
    if (!draft) return;
    const error = templateNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    setNameError(null);
    save.mutate(draft);
  }, [draft, draftName, save]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Templates",
          /*
           * In the header, not under the list. The action's reach must not
           * shrink as the list grows: below the rows, the cost of creating one
           * more rises with how many you already have.
           */
          headerRight: () =>
            canManage ? (
              <IconButton
                icon={Plus}
                accessibilityLabel="New template"
                surface={false}
                tone="primary"
                disabled={save.isPending}
                onPress={() => setChooserOpen(true)}
              />
            ) : null,
        }}
      />

      <Screen
        scroll
        padded={false}
        refreshing={checklistsQuery.isRefetching || workflowsQuery.isRefetching}
        onRefresh={() => {
          void checklistsQuery.refetch();
          void workflowsQuery.refetch();
        }}
        bottomInset={spacing.xxl}
      >
        <SectionHeader title="Libraries" />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListGroup>
            {LIBRARIES.map((library, index) => (
              <View key={library.title}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  icon={library.icon}
                  title={library.title}
                  subtitle={library.subtitle}
                  onPress={() => router.push(library.href)}
                />
              </View>
            ))}
          </ListGroup>
        </View>

        {checklistsQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : checklistsQuery.error ? (
          <ErrorState
            title="Could not load templates"
            message={errorText(checklistsQuery.error, "")}
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
                      ? {
                          label: "New template",
                          onPress: () => openDraft({ kind: "checklist", editing: null }),
                          icon: Plus,
                        }
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

            <SectionHeader title={`Workflows (${visibleWorkflows.length})`} />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              {visibleWorkflows.length === 0 ? (
                <Text variant="caption" tone="muted">
                  No workflow templates yet.
                </Text>
              ) : (
                <ListGroup>
                  {visibleWorkflows.map((template, index) => (
                    <View key={template.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={Workflow}
                        iconTone={template.archived ? "muted" : "primary"}
                        title={template.name}
                        subtitle={
                          [template.archived ? "Archived" : null, template.description]
                            .filter(Boolean)
                            .join(" · ") || undefined
                        }
                        chevron={!canManage}
                        right={
                          canManage ? (
                            <IconButton
                              icon={EllipsisVertical}
                              tone="muted"
                              surface={false}
                              accessibilityLabel={`More actions for ${template.name}`}
                              onPress={() => setWorkflowMenu(template)}
                            />
                          ) : undefined
                        }
                        onPress={
                          canManage
                            ? () =>
                                router.push({
                                  pathname: "/workflow-template/[templateId]",
                                  params: { templateId: template.id, name: template.name },
                                })
                            : undefined
                        }
                      />
                    </View>
                  ))}
                </ListGroup>
              )}
              {archivedWorkflows > 0 ? (
                <Button
                  label={
                    showArchivedWorkflows ? "Hide archived" : `Show ${archivedWorkflows} archived`
                  }
                  icon={Archive}
                  variant="ghost"
                  fullWidth
                  onPress={() => setShowArchivedWorkflows((current) => !current)}
                />
              ) : null}
              {!canManage && teamQuery.isSuccess ? (
                <Text variant="caption" tone="muted">
                  Only an owner or admin can change the shared library. You can still start a
                  checklist or workflow from any of these on a project.
                </Text>
              ) : null}
            </View>
          </>
        )}
      </Screen>

      <ActionSheet
        visible={chooserOpen}
        onClose={() => setChooserOpen(false)}
        title="What kind of template?"
        actions={[
          {
            label: "Checklist",
            icon: ClipboardCheck,
            onPress: () => openDraft({ kind: "checklist", editing: null }),
          },
          {
            label: "Workflow",
            icon: Workflow,
            onPress: () => openDraft({ kind: "workflow", editing: null }),
          },
          ...LIBRARIES.map((library) => ({
            label:
              library.title === "Walkthroughs" ? "Walkthrough" : library.title.replace(/s$/, ""),
            icon: library.icon,
            onPress: () => router.push(library.create),
          })),
        ]}
      />

      <ActionSheet
        visible={workflowMenu !== null}
        onClose={() => setWorkflowMenu(null)}
        title={workflowMenu?.name}
        actions={
          workflowMenu
            ? [
                {
                  label: "Rename",
                  icon: Pencil,
                  onPress: () => openDraft({ kind: "workflow", editing: workflowMenu }),
                },
                {
                  label: "Duplicate",
                  icon: Copy,
                  onPress: () =>
                    workflowAction.mutate(() => duplicateWorkflowTemplate(workflowMenu)),
                },
                {
                  label: workflowMenu.archived ? "Restore" : "Archive",
                  icon: Archive,
                  onPress: () =>
                    workflowAction.mutate(() =>
                      setWorkflowTemplateArchived(workflowMenu.id, !workflowMenu.archived),
                    ),
                },
                {
                  label: "Delete",
                  icon: Trash2,
                  destructive: true,
                  onPress: () =>
                    confirmDelete(
                      `Delete "${workflowMenu.name}"?`,
                      "It and all of its phases and steps will be removed. Projects already running this workflow keep their copy.",
                      "Delete workflow",
                      () => workflowAction.mutate(() => deleteWorkflowTemplate(workflowMenu.id)),
                    ),
                },
              ]
            : []
        }
      />

      <Sheet
        visible={draft !== null}
        onClose={() => setDraft(null)}
        title={
          draft?.editing
            ? "Rename workflow"
            : draft?.kind === "workflow"
              ? "New workflow template"
              : "New checklist template"
        }
        subtitle={
          draft?.editing
            ? undefined
            : draft?.kind === "workflow"
              ? "It starts with one phase. Add steps next."
              : "Name it now and add the items next."
        }
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder={draft?.kind === "workflow" ? "Install job" : "Pre-pour inspection"}
            error={nameError ?? undefined}
            autoCapitalize="sentences"
            returnKeyType="next"
          />
          <Field
            label="Description"
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder={
              draft?.kind === "workflow"
                ? "What this workflow is for"
                : "What this checklist is for"
            }
            multiline
            rows={3}
          />
          <Button
            label={
              draft?.editing
                ? "Save"
                : draft?.kind === "workflow"
                  ? "Save and add steps"
                  : "Create and add items"
            }
            icon={draft?.editing ? undefined : Plus}
            fullWidth
            loading={save.isPending}
            onPress={submit}
          />
        </View>
      </Sheet>
    </>
  );
}
