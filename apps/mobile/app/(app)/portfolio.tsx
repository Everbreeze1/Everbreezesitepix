import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Redirect, Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBlank,
  createFromProject,
  deletePortfolioProject,
  getMyPortfolio,
  listPortfolio,
  reorderPortfolioShowcases,
  setPortfolioShare,
  updatePortfolio,
  updatePortfolioProject,
  updateShowcaseSite,
} from "@/api/portfolio";
import {
  isPortfolioProjectEmpty,
  isPublished,
  LAYOUTS,
  movedIds,
  normaliseLayout,
  portfolioPageUrl,
  portfolioSiteUrl,
  portfolioSummary,
  portfolioTitleError,
  publishedCount,
  siteListingLabel,
  taglineError,
  type PortfolioProject,
} from "@/api/portfolio-view";
import { listProjects } from "@/api/projects";
import { openShareSheet, publicUrl } from "@/api/sharing";
import { ActionRail } from "@/components/ActionRail";
import { EmbedsPanel } from "@/components/portfolio/EmbedsPanel";
import { SiteEditor } from "@/components/portfolio/SiteEditor";
import { SwitchRow } from "@/components/portfolio/SwitchRow";
import { webAppLink } from "@/lib/api";
import { useAccountOwner } from "@/lib/use-access";
import { radius, spacing, useLayout, useRightRail, useTheme } from "@/theme";
import {
  ChevronDown,
  ChevronUp,
  Code,
  ExternalLink,
  FolderKanban,
  Globe,
  ImageOff,
  Layers,
  Plus,
  Send,
  Share2,
  Sparkles,
  Star,
  Trash2,
} from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  Sheet,
  SkeletonList,
  Text,
  useCardPage,
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
  /*
   * The account owner's screen, and nobody else's. The Portfolio is the
   * company's public face: the owner decides what is on it. The menu row and
   * the Account row are hidden for everybody else too; this is the same rule
   * for somebody who arrives by a link or a stale route.
   */
  const { isOwner, isLoading } = useAccountOwner();
  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Portfolio" }} />
        <SkeletonList rows={4} />
      </>
    );
  }
  if (!isOwner) return <Redirect href="/" />;
  return <OwnerPortfolio />;
}

type PortfolioTab = "site" | "projects" | "embeds";

const TABS = [
  { id: "site" as const, label: "Site", icon: Globe },
  { id: "projects" as const, label: "Projects", icon: Layers },
  { id: "embeds" as const, label: "Embeds", icon: Code },
];

function OwnerPortfolio() {
  const theme = useTheme();
  // Tablets and landscape: primary actions sit on the right, and the page is
  // centred and capped rather than stretched edge to edge.
  const rail = useRightRail();
  const { inset } = useCardPage();
  /*
   * On its side the page spreads rather than sitting in a centred column (Jon,
   * 2026-09-29: "when I turn the tablet horizontally it looks weird and too
   * centered"). The projects become a grid of cards, and the Site and Embeds
   * tabs lay their parts side by side. Upright is exactly as before.
   */
  const layout = useLayout();
  const projectColumns = layout.spread ? layout.columns(300, 3) : 1;
  // The Screen's own gutter (the notch, on its side) plus this page's.
  const projectCell =
    projectColumns > 1
      ? Math.floor(
          (layout.width - layout.inset(0) * 2 - inset * 2 - spacing.md * (projectColumns - 1)) /
            projectColumns,
        )
      : undefined;
  const queryClient = useQueryClient();

  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PortfolioProject | null>(null);
  const [listing, setListing] = useState<PortfolioProject | null>(null);
  const [listingDraft, setListingDraft] = useState({
    serviceType: "",
    summary: "",
    city: "",
    state: "",
    completedOn: "",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTagline, setDraftTagline] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<PortfolioTab>("site");
  const [publishing, setPublishing] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);

  const siteQuery = useQuery({ queryKey: ["my-portfolio"], queryFn: getMyPortfolio });
  const portfolioQuery = useQuery({ queryKey: ["portfolio"], queryFn: listPortfolio });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  // Only owners reach this screen, and an owner can always edit. `canEdit` is
  // still read so an older API that says otherwise is believed.
  const canManage = siteQuery.data?.canEdit ?? true;
  const site = siteQuery.data?.portfolio ?? null;
  const webBase = webAppLink("/")?.replace(/\/+$/, "") ?? null;
  const siteUrl = portfolioSiteUrl(webBase, site?.slug);
  const cards = useMemo(
    () => new Map((siteQuery.data?.showcases ?? []).map((card) => [card.id, card])),
    [siteQuery.data],
  );
  // The service already returns these in the portfolio's running order. See
  // the note in `portfolio-view.ts` for why re-sorting here was wrong.
  const pages = useMemo(() => {
    const rows = portfolioQuery.data ?? [];
    if (!order) return rows;
    // A reorder shows at once and is kept until the refetch agrees with it.
    const byId = new Map(rows.map((row) => [row.id, row]));
    return order.map((id) => byId.get(id)).filter((row): row is PortfolioProject => !!row);
  }, [portfolioQuery.data, order]);
  const live = publishedCount(pages);
  // Looked up from the list rather than held, so the sheet's switches show
  // the refetched state after each change instead of the row as first opened.
  const selected = pages.find((page) => page.id === selectedId) ?? null;
  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => !project.archived),
    [projectsQuery.data],
  );

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["my-portfolio"] });
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

  const refreshSite = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["my-portfolio"] });
    void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
  }, [queryClient]);

  /** The whole site live or not, the web's publish switch. */
  const togglePublished = useCallback(
    async (published: boolean) => {
      setPublishing(true);
      try {
        await updatePortfolio({ published });
        setFailure(null);
        refreshSite();
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "Could not change publish state.");
      } finally {
        setPublishing(false);
      }
    },
    [refreshSite],
  );

  const openSite = useCallback(async (url: string | null) => {
    if (!url) {
      setFailure("This build has no website address to open.");
      return;
    }
    await WebBrowser.openBrowserAsync(url);
  }, []);

  /** Up or down one place; the web drags, a phone taps. */
  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      const previous = pages.map((page) => page.id);
      const next = movedIds(previous, id, direction);
      if (next === previous) return;
      setOrder(next);
      reorderPortfolioShowcases(next)
        .then(() => {
          void queryClient
            .invalidateQueries({ queryKey: ["portfolio"] })
            .then(() => setOrder(null));
        })
        .catch((error: unknown) => {
          setOrder(null);
          setFailure(error instanceof Error ? error.message : "Could not save the new order.");
        });
    },
    [pages, queryClient],
  );

  const patchListing = useCallback(
    (project: PortfolioProject, patch: { onSite?: boolean; featured?: boolean }) =>
      run.mutate(() => updateShowcaseSite(project.id, patch)),
    [run],
  );

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
      const pageUrl = portfolioPageUrl(webBase, site?.slug, project.slug);
      actions.push({
        label: "View on site",
        icon: ExternalLink,
        disabled: !site?.published || !project.on_site || !pageUrl || !isPublished(project),
        onPress: () => void openSite(pageUrl),
      });
      actions.push({
        label: "Site listing",
        icon: Globe,
        onPress: () => {
          const card = cards.get(project.id);
          setListingDraft({
            serviceType: project.service_type ?? card?.service_type ?? "",
            summary: card?.summary ?? "",
            city: project.city ?? "",
            state: project.state ?? "",
            completedOn: card?.completed_on ?? "",
          });
          setListing(project);
        },
      });
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
    [confirmPublish, confirmDelete, share, webBase, site, openSite, cards],
  );

  const saveEdit = useCallback(() => {
    const error = portfolioTitleError(draftTitle) ?? taglineError(draftTagline);
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

  // Named because the header calls it; the list no longer has its own copy.
  const startEmptyPage = useCallback(() => {
    setDraftTitle("");
    setDraftTagline("");
    setTitleError(null);
    setEditing(null);
    setCreating(true);
  }, []);

  /** One project in the list, or one card of the grid on a screen held on its side. */
  const projectRow = (project: PortfolioProject) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={project.title}
      accessibilityHint="Opens this project's settings"
      onPress={() => setSelectedId(project.id)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        padding: spacing.md,
        backgroundColor: pressed ? theme.colors.secondary : "transparent",
      })}
    >
      {project.cover_image_url ? (
        <Image
          source={{ uri: project.cover_image_url }}
          style={{
            width: 64,
            height: 48,
            borderRadius: radius.sm,
            backgroundColor: theme.colors.secondary,
          }}
          contentFit="cover"
        />
      ) : (
        /*
            A page with no cover is usually a page with no
            photos, which is the state worth noticing before
            publishing.
          */
        <View
          accessibilityLabel="No photos yet"
          style={{
            width: 64,
            height: 48,
            borderRadius: radius.sm,
            backgroundColor: theme.colors.secondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon icon={ImageOff} size="sm" tone="muted" />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {project.title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {portfolioSummary(project)}
          {isPublished(project) && !project.on_site ? " · Hidden from site" : ""}
        </Text>
      </View>
      {project.featured ? <Icon icon={Star} size="sm" tone="safety" /> : null}
      <Badge
        label={isPublished(project) ? "Live" : "Draft"}
        tone={isPublished(project) ? "success" : "neutral"}
        variant={isPublished(project) ? "soft" : "outline"}
      />
    </Pressable>
  );

  const showRail = tab === "projects" && canManage && !portfolioQuery.isLoading;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Portfolio",
          /*
           * In the header, not under the list. The action's reach must not
           * shrink as the list grows: below the rows, the cost of creating one
           * more rises with how many you already have.
           */
          headerRight: () =>
            canManage ? (
              <IconButton
                icon={Plus}
                accessibilityLabel="Start an empty page"
                surface={false}
                tone="primary"
                onPress={startEmptyPage}
              />
            ) : null,
        }}
      />

      <View style={{ flex: 1 }}>
        <Screen
          scroll
          padded={false}
          refreshing={portfolioQuery.isRefetching || siteQuery.isRefetching}
          onRefresh={() => {
            void portfolioQuery.refetch();
            void siteQuery.refetch();
          }}
          // Room under the last row for the floating Build from a job button.
          bottomInset={showRail && pages.length > 0 ? spacing.xxl * 3 : spacing.xxl}
        >
          <View style={{ paddingHorizontal: inset, paddingTop: spacing.lg, gap: spacing.md }}>
            {siteQuery.isLoading ? (
              <SkeletonList rows={1} />
            ) : siteQuery.error ? (
              <ErrorState
                title="Could not load your portfolio site"
                message={siteQuery.error instanceof Error ? siteQuery.error.message : undefined}
                onRetry={() => void siteQuery.refetch()}
              />
            ) : site ? (
              /*
                The publish band, above the tabs as on the web: "is my site
                live, and what is the link?" is the question people open this
                to answer. Live shows the link and what to do with it; a draft
                shows only the switch that makes it live.
              */
              <Card>
                <View
                  style={{
                    flexDirection: rail ? "row" : "column",
                    alignItems: rail ? "center" : "stretch",
                    gap: spacing.md,
                  }}
                >
                  <View
                    style={{
                      flex: rail ? 1 : undefined,
                      minWidth: 0,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                    }}
                  >
                    <Badge
                      label={site.published ? "Live" : "Draft"}
                      tone={site.published ? "success" : "neutral"}
                      variant={site.published ? "soft" : "outline"}
                    />
                    <Text
                      variant={site.published ? "bodyStrong" : "caption"}
                      tone={site.published ? "default" : "muted"}
                      style={{ flex: 1 }}
                      numberOfLines={site.published ? 1 : 2}
                    >
                      {site.published
                        ? (siteUrl ?? `/p/${site.slug}`)
                        : "Not public yet. Publish to get a shareable link and turn on embeds."}
                    </Text>
                  </View>
                  {site.published ? (
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <Button
                        label="View website"
                        icon={ExternalLink}
                        size="sm"
                        variant="secondary"
                        disabled={!siteUrl}
                        onPress={() => void openSite(siteUrl)}
                      />
                      <Button
                        label="Share link"
                        icon={Share2}
                        size="sm"
                        variant="secondary"
                        disabled={!siteUrl}
                        onPress={() =>
                          siteUrl
                            ? void openShareSheet(siteUrl, site.business_name ?? "Our work")
                            : undefined
                        }
                      />
                    </View>
                  ) : null}
                  <View style={rail ? { width: 180 } : undefined}>
                    <SwitchRow
                      label="Publish site"
                      value={site.published}
                      disabled={publishing || !canManage}
                      onChange={(next) => void togglePublished(next)}
                    />
                  </View>
                </View>
              </Card>
            ) : null}

            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}
          </View>

          {/* The web's three tabs, in its order: the site, the projects that fill it, the embeds. */}
          <View style={{ paddingTop: spacing.md, paddingHorizontal: inset - spacing.lg }}>
            <ChipGroup
              label="Portfolio sections"
              options={TABS.map((t) =>
                t.id === "projects" && pages.length > 0 ? { ...t, count: pages.length } : t,
              )}
              value={tab}
              onChange={setTab}
            />
          </View>

          <View style={{ paddingHorizontal: inset, paddingTop: spacing.lg, gap: spacing.md }}>
            {tab === "site" ? (
              site ? (
                <SiteEditor site={site} onSaved={refreshSite} />
              ) : siteQuery.isLoading ? null : (
                <EmptyState icon={Globe} title="No portfolio site yet" />
              )
            ) : tab === "embeds" ? (
              site ? (
                <EmbedsPanel site={site} webBase={webBase} onKeyRotated={refreshSite} />
              ) : null
            ) : portfolioQuery.isLoading ? (
              <SkeletonList rows={4} />
            ) : portfolioQuery.error ? (
              <ErrorState
                title="Could not load your portfolio"
                message={
                  portfolioQuery.error instanceof Error ? portfolioQuery.error.message : undefined
                }
                onRetry={() => void portfolioQuery.refetch()}
              />
            ) : pages.length === 0 ? (
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
              <>
                <Text variant="caption" tone="muted">
                  {live} of {pages.length} live. The order here is the order visitors see. Tap a
                  project to publish, feature or move it.
                </Text>
                {projectColumns > 1 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
                    {pages.map((project) => (
                      <View key={project.id} style={{ width: projectCell }}>
                        <ListGroup>{projectRow(project)}</ListGroup>
                      </View>
                    ))}
                  </View>
                ) : (
                  <ListGroup>
                    {pages.map((project, index) => (
                      <View key={project.id}>
                        {index > 0 ? <RowDivider /> : null}
                        {projectRow(project)}
                      </View>
                    ))}
                  </ListGroup>
                )}
                <Text variant="caption" tone="muted">
                  Each page&apos;s photos, sections and long intro are edited in the page builder on
                  the website.
                </Text>
              </>
            )}

            {tab === "projects" && !canManage ? (
              <Text variant="caption" tone="muted">
                Only an owner or admin can change the portfolio.
              </Text>
            ) : null}
          </View>
        </Screen>

        {/*
          Building a page from a finished job is this tab's main act, so it
          floats at the lower right where the thumb is, on a phone and as a
          labelled pill on a tablet. Hidden while the empty state offers it.
        */}
        {!showRail || pages.length === 0 ? null : (
          <ActionRail
            actions={[
              {
                key: "build-from-job",
                icon: FolderKanban,
                label: "Build from a job",
                hint: "Turn a finished job's photos into a portfolio page",
                disabled: run.isPending,
                onPress: () => setPicking(true),
              },
            ]}
          />
        )}
      </View>

      {/*
        One project's settings. The two switches the web grid carries on each
        card (listed on the site, featured) and the running order sit at the
        top; everything rarer is a row underneath.
      */}
      <Sheet
        visible={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.title}
        subtitle={selected ? portfolioSummary(selected) : undefined}
      >
        {selected ? (
          <>
            {canManage ? (
              <Card>
                <View style={{ gap: spacing.md }}>
                  <SwitchRow
                    label="On site"
                    hint={
                      siteListingLabel(selected) === "Draft"
                        ? "Publish this page before it can be listed."
                        : `${siteListingLabel(selected)}${
                            cards.get(selected.id)?.service_type
                              ? ` · ${cards.get(selected.id)?.service_type}`
                              : ""
                          }`
                    }
                    value={Boolean(selected.on_site)}
                    disabled={run.isPending || !isPublished(selected)}
                    onChange={(next) => patchListing(selected, { onSite: next })}
                  />
                  <SwitchRow
                    label="Featured"
                    hint="A badge on this project's card on your site."
                    value={Boolean(selected.featured)}
                    disabled={run.isPending}
                    onChange={(next) => patchListing(selected, { featured: next })}
                  />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Text variant="bodyStrong" style={{ flex: 1 }}>
                      Position {pages.findIndex((p) => p.id === selected.id) + 1} of {pages.length}
                    </Text>
                    <IconButton
                      icon={ChevronUp}
                      accessibilityLabel={`Move ${selected.title} up`}
                      disabled={pages[0]?.id === selected.id}
                      onPress={() => move(selected.id, -1)}
                    />
                    <IconButton
                      icon={ChevronDown}
                      accessibilityLabel={`Move ${selected.title} down`}
                      disabled={pages[pages.length - 1]?.id === selected.id}
                      onPress={() => move(selected.id, 1)}
                    />
                  </View>
                </View>
              </Card>
            ) : null}
            {canManage ? (
              <ListGroup>
                {rowActions(selected).map((action, index) => (
                  <View key={action.label}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      icon={action.icon}
                      iconTone={action.destructive ? "destructive" : "primary"}
                      title={action.label}
                      destructive={action.destructive}
                      disabled={action.disabled}
                      chevron={false}
                      onPress={() => {
                        setSelectedId(null);
                        action.onPress();
                      }}
                    />
                  </View>
                ))}
              </ListGroup>
            ) : null}
          </>
        ) : null}
      </Sheet>

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
        footer={
          <View style={{ alignItems: rail ? "flex-end" : "stretch" }}>
            <Button label="Save" fullWidth={!rail} onPress={saveEdit} />
          </View>
        }
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
        </View>
      </Sheet>
      <Sheet
        visible={listing !== null}
        onClose={() => setListing(null)}
        title="Site listing"
        subtitle="How this page is filed and filtered on your portfolio site."
        footer={
          <View style={{ alignItems: rail ? "flex-end" : "stretch" }}>
            <Button
              label="Save listing"
              fullWidth={!rail}
              onPress={() => {
                const target = listing;
                const done = listingDraft.completedOn.trim();
                if (!target || (done && !/^\d{4}-\d{2}-\d{2}$/.test(done))) return;
                setListing(null);
                run.mutate(() =>
                  updateShowcaseSite(target.id, {
                    serviceType: listingDraft.serviceType.trim() || null,
                    summary: listingDraft.summary.trim() || null,
                    city: listingDraft.city.trim() || null,
                    state: listingDraft.state.trim() || null,
                    completedOn: done || null,
                  }),
                );
              }}
            />
          </View>
        }
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Service"
            value={listingDraft.serviceType}
            onChangeText={(next) => setListingDraft((d) => ({ ...d, serviceType: next }))}
            placeholder="Roofing"
          />
          {(siteQuery.data?.serviceTypes ?? []).length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
              {(siteQuery.data?.serviceTypes ?? []).map((type) => (
                <Chip
                  key={type}
                  label={type}
                  selected={listingDraft.serviceType === type}
                  onPress={() => setListingDraft((d) => ({ ...d, serviceType: type }))}
                />
              ))}
            </View>
          ) : null}
          <Field
            label="Summary"
            value={listingDraft.summary}
            onChangeText={(next) => setListingDraft((d) => ({ ...d, summary: next }))}
            hint="One or two lines under the card."
            multiline
            rows={3}
          />
          <Field
            label="Town or city"
            value={listingDraft.city}
            onChangeText={(next) => setListingDraft((d) => ({ ...d, city: next }))}
          />
          <Field
            label="County or state"
            value={listingDraft.state}
            onChangeText={(next) => setListingDraft((d) => ({ ...d, state: next }))}
          />
          <Field
            label="Completed on"
            value={listingDraft.completedOn}
            onChangeText={(next) => setListingDraft((d) => ({ ...d, completedOn: next }))}
            placeholder="YYYY-MM-DD"
            error={
              listingDraft.completedOn.trim() &&
              !/^\d{4}-\d{2}-\d{2}$/.test(listingDraft.completedOn.trim())
                ? "Use YYYY-MM-DD"
                : undefined
            }
          />
        </View>
      </Sheet>
    </>
  );
}
