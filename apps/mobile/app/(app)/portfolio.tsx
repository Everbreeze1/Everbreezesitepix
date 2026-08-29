import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Image } from "expo-image";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can } from "@everlumen/shared/team-permissions";
import {
  createBlank,
  createFromProject,
  deletePortfolioProject,
  listPortfolio,
  setPortfolioShare,
  updatePortfolioProject,
} from "@/api/portfolio";
import {
  isPortfolioProjectEmpty,
  isPublished,
  LAYOUTS,
  normaliseLayout,
  orderedPortfolio,
  portfolioSummary,
  portfolioTitleError,
  publishedCount,
  type PortfolioProject,
} from "@/api/portfolio-view";
import { listProjects } from "@/api/projects";
import { openShareSheet, publicUrl } from "@/api/sharing";
import { getMyTeam } from "@/api/team";
import { radius, spacing, useTheme } from "@/theme";
import { FolderKanban, ImageOff, Plus, Send, Share2, Sparkles, Trash2 } from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  Sheet,
  SkeletonList,
  Text,
  type SheetAction,
} from "@/ui";

/**
 * The Portfolio.
 *
 * A shareable mini-site of the company's best work, one page per project.
 *
 * **The words here are the client's and they are load-bearing.** The site is
 * the "Portfolio"; each page in it is a "project". The tables and ops say
 * `showcase` and always will, because renaming them is a migration for no
 * benefit, but the identifier must never reach the screen. There is no
 * collision with the app's own projects: a portfolio project **is** the public
 * page for one of them.
 *
 * Which is why "Build from a job" is the headline action rather than a
 * shortcut. Photos are already tagged before, progress and after, and that
 * tagging is the story: the op groups them into three sections and writes the
 * page. Somebody finishing a job can publish it before leaving the site, which
 * is a thing a desktop tool cannot offer at all.
 */
export default function PortfolioScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PortfolioProject | null>(null);
  const [actionsFor, setActionsFor] = useState<PortfolioProject | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTagline, setDraftTagline] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const portfolioQuery = useQuery({ queryKey: ["portfolio"], queryFn: listPortfolio });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });

  const canManage = can(teamQuery.data?.myRole, "manage_templates");
  const pages = useMemo(() => orderedPortfolio(portfolioQuery.data ?? []), [portfolioQuery.data]);
  const live = publishedCount(pages);
  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => !project.archived),
    [projectsQuery.data],
  );

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not work."),
  });

  const share = useCallback(async (project: PortfolioProject) => {
    const url = publicUrl("showcases", project.share_token);
    if (!url) {
      setFailure("No public link yet. Publish this page first.");
      return;
    }
    await openShareSheet(url, project.title);
  }, []);

  const confirmDelete = useCallback(
    (project: PortfolioProject) => {
      Alert.alert(
        `Delete "${project.title}"?`,
        isPublished(project)
          ? "The job and its photos are untouched. The public page goes, and anyone holding its link will find nothing there."
          : "The job and its photos are untouched. Only this portfolio page goes.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => run.mutate(() => deletePortfolioProject(project.id)),
          },
        ],
      );
    },
    [run],
  );

  const confirmPublish = useCallback(
    (project: PortfolioProject) => {
      const publishing = !isPublished(project);
      if (publishing && isPortfolioProjectEmpty(project)) {
        /*
         * Asked, not blocked. It is their portfolio and their call, but a page
         * with no photos published under the company name is a mistake nobody
         * would make deliberately.
         */
        Alert.alert(
          "This page has no photos",
          "Publishing it puts a title on an empty page under your company name. Add photos first, or publish anyway.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Publish anyway",
              onPress: () => run.mutate(() => setPortfolioShare(project.id, true)),
            },
          ],
        );
        return;
      }
      run.mutate(() => setPortfolioShare(project.id, publishing));
    },
    [run],
  );

  const rowActions = useCallback(
    (project: PortfolioProject): SheetAction[] => {
      const actions: SheetAction[] = [
        {
          label: isPublished(project) ? "Unpublish" : "Publish",
          icon: Share2,
          onPress: () => confirmPublish(project),
        },
      ];
      if (isPublished(project)) {
        actions.push({ label: "Send the link", icon: Send, onPress: () => void share(project) });
      }
      actions.push({
        label: "Rename",
        onPress: () => {
          setDraftTitle(project.title);
          setDraftTagline(project.tagline ?? "");
          setTitleError(null);
          setEditing(project);
        },
      });
      actions.push({
        label: "Delete",
        icon: Trash2,
        destructive: true,
        onPress: () => confirmDelete(project),
      });
      return actions;
    },
    [confirmPublish, confirmDelete, share],
  );

  const saveEdit = useCallback(() => {
    const error = portfolioTitleError(draftTitle);
    if (error) {
      setTitleError(error);
      return;
    }
    const target = editing;
    const title = draftTitle.trim();
    const tagline = draftTagline.trim() || null;
    setEditing(null);
    setCreating(false);

    if (target) {
      run.mutate(() => updatePortfolioProject(target.id, { title, tagline }));
    } else {
      run.mutate(() => createBlank(title, tagline));
    }
  }, [editing, draftTitle, draftTagline, run]);

  return (
    <>
      <Stack.Screen options={{ title: "Portfolio" }} />

      <Screen
        scroll
        padded={false}
        refreshing={portfolioQuery.isRefetching}
        onRefresh={() => void portfolioQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs }}>
          <Text variant="caption" tone="muted">
            A shareable mini-site of your best work, one page per project.
            {pages.length > 0 ? ` ${live} of ${pages.length} live.` : ""}
          </Text>
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
        </View>

        {portfolioQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : portfolioQuery.error ? (
          <ErrorState
            title="Could not load your portfolio"
            message={
              portfolioQuery.error instanceof Error ? portfolioQuery.error.message : undefined
            }
            onRetry={() => void portfolioQuery.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {pages.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Nothing in your portfolio yet"
                body="Pick a finished job and the before, progress and after photos become a page you can send to anyone. That tagging is already the story."
                action={
                  canManage
                    ? {
                        label: "Build from a job",
                        onPress: () => setPicking(true),
                        icon: FolderKanban,
                      }
                    : undefined
                }
              />
            ) : (
              pages.map((project) => (
                <Card key={project.id}>
                  <View style={{ gap: spacing.md }}>
                    {project.coverUrl ? (
                      <Image
                        source={{ uri: project.coverUrl }}
                        style={{
                          width: "100%",
                          aspectRatio: 16 / 9,
                          borderRadius: radius.md,
                          backgroundColor: theme.colors.secondary,
                        }}
                        contentFit="cover"
                      />
                    ) : (
                      /*
                        A page with no cover is usually a page with no photos,
                        which is the state worth noticing before publishing.
                      */
                      <View
                        style={{
                          width: "100%",
                          aspectRatio: 16 / 9,
                          borderRadius: radius.md,
                          backgroundColor: theme.colors.secondary,
                          alignItems: "center",
                          justifyContent: "center",
                          gap: spacing.xs,
                        }}
                      >
                        <Badge label="No photos yet" tone="neutral" icon={ImageOff} />
                      </View>
                    )}

                    <View
                      style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
                    >
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text variant="bodyStrong" numberOfLines={2}>
                          {project.title}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {portfolioSummary(project)}
                        </Text>
                      </View>
                      <Badge
                        label={isPublished(project) ? "Live" : "Draft"}
                        tone={isPublished(project) ? "success" : "neutral"}
                        variant={isPublished(project) ? "soft" : "outline"}
                      />
                    </View>

                    {project.tagline ? (
                      <Text variant="caption" tone="muted" numberOfLines={3}>
                        {project.tagline}
                      </Text>
                    ) : null}

                    {canManage ? (
                      <Button
                        label="Manage"
                        size="sm"
                        variant="secondary"
                        onPress={() => setActionsFor(project)}
                      />
                    ) : null}
                  </View>
                </Card>
              ))
            )}

            {canManage && pages.length > 0 ? (
              <>
                <Button
                  label="Build from a job"
                  icon={FolderKanban}
                  variant="secondary"
                  fullWidth
                  disabled={run.isPending}
                  onPress={() => setPicking(true)}
                />
                <Button
                  label="Start an empty page"
                  icon={Plus}
                  variant="ghost"
                  fullWidth
                  onPress={() => {
                    setDraftTitle("");
                    setDraftTagline("");
                    setTitleError(null);
                    setEditing(null);
                    setCreating(true);
                  }}
                />
              </>
            ) : null}

            {!canManage ? (
              <Text variant="caption" tone="muted">
                Only an owner or admin can change the portfolio.
              </Text>
            ) : null}

            {/*
              Layout and the long-form intro and outro stay on the web. They are
              page-design choices made once, on a big screen, and a phone editor
              for them would be worse than the browser the person already has.
            */}
            <Text variant="caption" tone="muted">
              Page layout, the intro and the closing text are edited on the web. What is here is
              what you would want on site: build a page from a job, publish it, send the link.
            </Text>
          </View>
        )}
      </Screen>

      <ActionSheet
        visible={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        title={actionsFor?.title}
        actions={actionsFor ? rowActions(actionsFor) : []}
      />

      <Sheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Build from a job"
        subtitle="The before, progress and after photos become the page."
      >
        {projectsQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : projects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No jobs to build from yet" />
        ) : (
          <ListGroup>
            {projects.map((project, index) => (
              <View key={project.id}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  icon={FolderKanban}
                  title={project.name}
                  subtitle={project.client_name ?? project.city ?? undefined}
                  onPress={() => {
                    setPicking(false);
                    run.mutate(() => createFromProject(project.id));
                  }}
                />
              </View>
            ))}
          </ListGroup>
        )}
      </Sheet>

      <Sheet
        visible={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? "Rename page" : "New portfolio page"}
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Title"
            value={draftTitle}
            onChangeText={(next) => {
              setDraftTitle(next);
              if (titleError) setTitleError(null);
            }}
            placeholder="Riverside roof replacement"
            error={titleError ?? undefined}
            autoCapitalize="sentences"
          />
          <Field
            label="Tagline"
            value={draftTagline}
            onChangeText={setDraftTagline}
            placeholder="A line under the title"
            hint="Optional"
            multiline
            rows={2}
          />

          {editing ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="caption" tone="muted">
                Layout
              </Text>
              <ListGroup>
                {LAYOUTS.map((layout, index) => (
                  <View key={layout.id}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={layout.label}
                      subtitle={layout.hint}
                      value={normaliseLayout(editing.layout) === layout.id ? "Current" : undefined}
                      onPress={() => {
                        const target = editing;
                        setEditing(null);
                        run.mutate(() => updatePortfolioProject(target.id, { layout: layout.id }));
                      }}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          ) : null}

          <Button label="Save" fullWidth onPress={saveEdit} />
        </View>
      </Sheet>
    </>
  );
}
