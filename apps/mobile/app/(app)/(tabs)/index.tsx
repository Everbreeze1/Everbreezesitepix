import { useMemo } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import {
  isProjectStatus,
  PROJECT_STATUS_LABELS,
  projectDisplayName,
  relativeTime,
} from "@everlumen/shared";
import {
  countPhotosNeedingReview,
  listMyOpenTasks,
  listProjectPhotoStats,
  listRecentCaptureTimes,
  listRecentlyPhotographedProjects,
  type ProjectPhotoStats,
} from "@/api/dashboard";
import {
  bucketOf,
  capturedTodayLabel,
  countToday,
  documentationHealth,
  dueLabel,
  greeting,
  headline,
  needsYou,
  photoCountLabel,
} from "@/api/dashboard-view";
import { getUnreadNotificationCount } from "@/api/notifications";
import { listGalleryPhotoPage, listProjectCovers, type GalleryPhotoItem } from "@/api/photos";
import { listProjects, type ProjectListItem } from "@/api/projects";
import { ActionRail } from "@/components/ActionRail";
import { BrandMark } from "@/components/BrandMark";
import { QueueBanner } from "@/components/QueueBanner";
import { useAuth } from "@/lib/auth";
import { useQuickCapture } from "@/lib/use-quick-capture";
import { useQueue } from "@/offline/use-queue";
import { contentWidth, gridColumns, radius, spacing, useRightRail, useTheme } from "@/theme";
import {
  Activity,
  Bell,
  Calendar,
  Camera,
  CloudUpload,
  FileText,
  FolderKanban,
  FolderPlus,
  MapPin,
  Plus,
  TriangleAlert,
} from "@/ui/icons";
import {
  Badge,
  Icon,
  PhotoThumb,
  Screen,
  type BadgeTone,
  type LucideIcon,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Home: where every job stands, and what needs you today.
 *
 * The counts are the web dashboard's, drawn for a phone: the four a crew lead
 * acts on (active, photos today, on hold, tasks due) plus the two the office
 * reads the board by (documentation health and needs review), with the web's
 * own definitions so both screens show the same numbers. Every one of them is a
 * real query: a count with no source behind it is worse than no count. The
 * seven-day sparkline stays on the web; it answers a desk question.
 *
 * The order below the counts is by urgency and it is fixed. Anything the phone
 * still has to send comes first because it is the only item on the screen that
 * can be lost; the two actions come next because they are why the app is
 * opened; then the jobs, overdue work, the photographs, and last the menu.
 *
 * This replaced the project list as the first tab, and the project list moved
 * to `projects.tsx` alongside it. Opening onto a list of jobs makes finding a
 * job the first thing the app is for, and it is not: knowing whether anything
 * needs you is.
 */
/*
 * Three across on a phone, more on a tablet, and measured every render.
 *
 * The count was hardcoded and the width came from `Dimensions.get("window")`,
 * read once and never again, so rotating an iPad left the tiles at the old
 * size. It is `contentWidth` rather than the raw width because this screen is
 * inside a `Screen`, which centres its content in a 640pt column on a wide
 * display: sizing five tiles across 1024pt would push them straight out of it.
 *
 * The target is smaller than the photo-grid default on purpose. These are
 * shortcut buttons, not thumbnails, and the 130pt photo tile would give a phone
 * two columns where it has always had three.
 */
const BROWSE_TARGET_TILE = 110;

/**
 * How many photographs the home strip asks for.
 *
 * Twelve rather than a screenful: the strip scrolls, and the point is to show
 * that the work exists and give a way in, not to be a second gallery. It is
 * also a page small enough that the request costs nothing on a van's worth of
 * signal, which is the connection this screen usually loads on.
 */
const STRIP_PHOTOS = 12;

/** Edge of one photograph in the strip. Two and a bit visible on a phone. */
const STRIP_TILE = 104;

/** Edge of a job's cover on its card. Big enough to recognise the site from. */
const JOB_COVER = 56;

/** How many jobs the Recent jobs list shows before handing over to Projects. */
const RECENT_JOBS = 3;

/** How many attention cards before the rest collapse into a line of text. */
const ATTENTION_CAP = 6;

/*
 * Tile width, measured rather than expressed as a percentage.
 *
 * `width: "32%"` with a gap between them overflows: three tiles plus two gaps
 * came to a few points more than the row, so the third wrapped and the grid
 * silently became two columns. Percentages cannot see the gap; arithmetic can.
 * Same approach the photo grids use.
 */
function useBrowseTile(): number {
  const { width } = useWindowDimensions();
  const usable = contentWidth(width) - spacing.lg * 2;
  const columns = gridColumns(usable, BROWSE_TARGET_TILE);
  return (usable - spacing.sm * (columns - 1)) / columns;
}

/**
 * The browse destinations, in the order somebody reaches for them.
 *
 * Map first because it is the only one that answers a question you have while
 * standing outside: which of these am I at.
 *
 * The Assistant tile is gone. The web app folded its assistant into the
 * background rather than keeping it as a place you visit, and a tile here would
 * be the only door left to a room the product no longer has.
 */
const BROWSE: { icon: LucideIcon; label: string; href: string }[] = [
  { icon: FileText, label: "Reports", href: "/reports" },
  { icon: MapPin, label: "Map", href: "/map" },
  { icon: FolderKanban, label: "Pipelines", href: "/pipelines" },
  { icon: Calendar, label: "Timeline", href: "/timeline" },
  { icon: FolderPlus, label: "Groups", href: "/groups" },
  { icon: Activity, label: "Team", href: "/activity" },
];

/**
 * Status to pill colour. The same mapping the Projects tab uses, so a job on
 * hold is the same amber on both screens.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  active: "success",
  on_hold: "warning",
  completed: "neutral",
};

/**
 * The name a person signed up with, if they gave one.
 *
 * Sign-up writes `full_name` into the auth user's metadata. Nothing else on the
 * phone knows a person's name, and the email's local part is not one: greeting
 * "jsmith92" by name is worse than not greeting them by name at all.
 */
function fullNameOf(metadata: Record<string, unknown> | undefined): string | null {
  const raw = metadata?.full_name;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Up to two initials, from the name when there is one and the email when not. */
function initialsOf(name: string | null, email: string | null | undefined): string {
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase() || "?";
  }
  return (email?.trim()[0] ?? "?").toUpperCase();
}

export default function HomeScreen() {
  const theme = useTheme();
  const openCamera = useQuickCapture();
  const rail = useRightRail();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queue = useQueue();

  const tasksQuery = useQuery({
    queryKey: ["my-open-tasks", user?.id],
    queryFn: () => listMyOpenTasks(user!.id),
    enabled: Boolean(user?.id),
  });

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const unreadQuery = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: getUnreadNotificationCount,
    staleTime: 60_000,
  });

  const capturesQuery = useQuery({
    queryKey: ["recent-capture-times"],
    queryFn: listRecentCaptureTimes,
    staleTime: 5 * 60 * 1000,
  });

  /*
   * The photographs themselves, which is what this product is.
   *
   * One page of the gallery, newest first across every job, is the cheapest
   * way to put the work on the first screen - it is the same query the Gallery
   * tab already runs, so it is warm by the time somebody gets there.
   */
  const recentPhotosQuery = useQuery({
    queryKey: ["home-recent-photos"],
    queryFn: () => listGalleryPhotoPage(null, STRIP_PHOTOS),
    staleTime: 60_000,
  });

  /*
   * Untagged photos, the web dashboard's "Needs review". The tile opens the
   * gallery with the same filter applied, so the number and the list agree.
   */
  const reviewQuery = useQuery({
    queryKey: ["dashboard-needs-review"],
    queryFn: countPhotosNeedingReview,
    staleTime: 5 * 60 * 1000,
  });

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const urgent = useMemo(() => needsYou(tasks), [tasks]);

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, projectDisplayName(project));
    return map;
  }, [projects]);

  /*
   * The board, counted from the same list the Projects tab loads.
   *
   * Archived jobs are left out of both counts, as they are out of the Projects
   * tab's default view: an archived job that was on hold when it was put away
   * is not something anybody is waiting on.
   */
  const counts = useMemo(() => {
    let active = 0;
    let onHold = 0;
    for (const project of projects) {
      if (project.archived) continue;
      if (project.status === "active") active += 1;
      else if (project.status === "on_hold") onHold += 1;
    }
    return { active, onHold };
  }, [projects]);

  /*
   * Recently touched open jobs. `listProjects` already comes back
   * newest-updated first, so this is the few jobs somebody was actually on,
   * which is what "jump back in" means on a phone. Completed jobs are left out:
   * nobody goes back to a finished site from the home screen.
   */
  const recent = useMemo(
    () =>
      projects
        .filter((project) => !project.archived && project.status !== "completed")
        .slice(0, RECENT_JOBS),
    [projects],
  );
  /*
   * Documentation health: the share of active jobs photographed in the last
   * seven days. Active here means active and not archived, the same set the
   * Active projects tile counts, so the percentage is "of those".
   */
  const activeIds = useMemo(
    () =>
      projects
        .filter((project) => !project.archived && project.status === "active")
        .map((project) => project.id),
    [projects],
  );
  const healthQuery = useQuery({
    queryKey: ["dashboard-doc-health", activeIds.join(",")],
    queryFn: () => listRecentlyPhotographedProjects(activeIds),
    enabled: Boolean(projectsQuery.data),
    staleTime: 5 * 60 * 1000,
  });
  const docHealth = healthQuery.data ? documentationHealth(activeIds, healthQuery.data) : null;

  const recentIds = useMemo(() => {
    const ids: string[] = [];
    for (const project of recent) ids.push(project.id);
    return ids;
  }, [recent]);

  // One round trip for all three covers, the same call the Projects tab makes.
  const coversQuery = useQuery({
    queryKey: ["project-covers", recentIds.join(",")],
    queryFn: () => listProjectCovers(recentIds),
    enabled: recentIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const covers = coversQuery.data ?? {};

  /*
   * Photo count and last photo per recent job, the web's "On site now" line.
   * One bounded request per job, and there are three of them.
   */
  const statsQuery = useQuery({
    queryKey: ["project-photo-stats", recentIds.join(",")],
    queryFn: () => listProjectPhotoStats(recentIds),
    enabled: recentIds.length > 0,
    staleTime: 60_000,
  });
  const stats = statsQuery.data ?? {};

  const stripPhotos = recentPhotosQuery.data?.photos ?? [];
  const stripUrls = recentPhotosQuery.data?.urls ?? {};

  const unread = unreadQuery.data ?? 0;
  const loading = tasksQuery.isLoading || projectsQuery.isLoading;

  const fullName = fullNameOf(user?.user_metadata);
  const firstName = fullName?.split(/\s+/)[0] ?? null;

  const refreshing =
    tasksQuery.isRefetching ||
    projectsQuery.isRefetching ||
    capturesQuery.isRefetching ||
    recentPhotosQuery.isRefetching ||
    healthQuery.isRefetching ||
    reviewQuery.isRefetching;

  const refresh = () => {
    void tasksQuery.refetch();
    void projectsQuery.refetch();
    void unreadQuery.refetch();
    void capturesQuery.refetch();
    void recentPhotosQuery.refetch();
    void coversQuery.refetch();
    void healthQuery.refetch();
    void reviewQuery.refetch();
    void statsQuery.refetch();
  };

  /*
   * A number only once its query has answered. While loading, or after an
   * error, the tile shows a dash: a zero there would be a claim ("nothing on
   * hold") the app cannot back.
   */
  const projectCount = (value: number) => (projectsQuery.data ? value : null);
  const photosToday = capturesQuery.data ? countToday(capturesQuery.data) : null;
  const tasksDue = tasksQuery.data ? urgent.length : null;
  const needsReview = reviewQuery.data ?? null;

  /*
   * The line under the greeting. The mockup's sentence when nothing is
   * pressing; otherwise the single most pressing thing, in words, because a
   * greeting that says "here's where things stand" over a queue of unsent
   * photos is reassurance the screen has not earned.
   */
  const overdue = urgent.filter((task) => bucketOf(task) === "overdue").length;
  const pressing = {
    overdue,
    dueToday: urgent.length - overdue,
    unread,
    queued: queue.outstanding,
  };
  const calm = !pressing.overdue && !pressing.dueToday && !pressing.unread && !pressing.queued;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/*
        The one header this tab draws. Tabs run with the navigator header
        switched off, so this is the only bar on the screen, and it stays put
        while the page scrolls under it.
      */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingTop: insets.top + spacing.sm,
          paddingBottom: spacing.sm,
          paddingHorizontal: spacing.lg,
          backgroundColor: theme.colors.card,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm }}
          accessible
          accessibilityRole="header"
          accessibilityLabel="Everlumen"
        >
          <BrandMark size={28} gapColor={theme.colors.card} />
          <Text variant="heading" style={{ fontWeight: "700" }}>
            Everlumen
          </Text>
        </View>

        {/*
          Notifications moved here from a row further down the page. The count
          is said once, in the label a screen reader reads; the dot is what a
          sighted person sees. A number on the bell as well would be the badge
          this screen already argued its way out of once.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unread === 0 ? "Notifications, nothing unread" : `Notifications, ${unread} unread`
          }
          onPress={() => router.push("/notifications")}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon icon={Bell} size="lg" />
          {unread > 0 ? (
            <View
              style={{
                position: "absolute",
                top: 9,
                right: 10,
                width: 9,
                height: 9,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.primary,
                borderWidth: 1.5,
                borderColor: theme.colors.card,
              }}
            />
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account"
          onPress={() => router.push("/account")}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            // Inverted rather than tinted: the mockup draws the person as the
            // one solid dark mark in the bar, in either scheme.
            backgroundColor: theme.colors.foreground,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text variant="bodyStrong" style={{ color: theme.colors.background }}>
            {initialsOf(fullName, user?.email)}
          </Text>
        </Pressable>
      </View>

      <Screen scroll padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={96}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.xs }}>
          <Text variant="display">
            {firstName ? `${greeting()}, ${firstName}.` : `${greeting()}.`}
          </Text>
          <Text variant="body" tone="muted">
            {calm ? "Here's where every job on the board stands today." : headline(pressing)}
          </Text>
        </View>

        {/*
          The queue first, always. It is the only thing on this screen that can
          actually be lost, and it is the one piece of state no server knows
          about.

          The wrapper is conditional, not just the banner. `QueueBanner`
          returns null when the queue is clear, but its padding did not, which
          on a clear queue - the normal state - left a band of nothing.
        */}
        {queue.outstanding > 0 ? (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <QueueBanner />
          </View>
        ) : null}

        {/*
          The board in six numbers. Rows of two rather than a wrapped grid, so
          each tile is exactly half the row whatever the gap. The web's two
          office numbers sit in the middle row, between the jobs and the work.
        */}
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <StatTile
              label="Active projects"
              value={projectCount(counts.active)}
              onPress={() => router.push("/projects")}
            />
            <StatTile
              label="Photos today"
              value={photosToday}
              spoken={photosToday === null ? undefined : capturedTodayLabel(photosToday)}
              onPress={() => router.push("/gallery")}
            />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <StatTile
              label="Documentation health"
              value={docHealth}
              format={(value) => `${value}%`}
              spoken={
                docHealth === null
                  ? "Documentation health: no active projects"
                  : `Documentation health: ${docHealth} percent of active projects photographed this week`
              }
              onPress={() => router.push("/projects")}
            />
            <StatTile
              label="Needs review"
              value={needsReview}
              warn
              spoken={
                needsReview === null ? undefined : `Needs review: ${needsReview} untagged photos`
              }
              onPress={() =>
                router.push({
                  pathname: "/gallery",
                  params: { review: "1", nonce: String(Date.now()) },
                })
              }
            />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <StatTile
              label="On hold"
              value={projectCount(counts.onHold)}
              warn
              onPress={() => router.push("/projects")}
            />
            {/*
              Overdue and due today, assigned to you: the same list "Needs
              attention" draws below. The mockup has "Reports due" here, and
              nothing in the data has a due date for a report, so this is the
              closest thing that does.
            */}
            <StatTile label="Tasks due" value={tasksDue} warn />
          </View>
        </View>

        {/*
          The two things the app is opened to do, above every list so that no
          amount of data can push them off the first screen.

          Not on a tablet or in landscape. There the page is a centred column
          and this row would sit in the middle of the screen, out of reach of
          the thumb resting on the right edge. The camera is already the foot
          of the tab rail on that edge, so New project floats beside it (see
          the `ActionRail` at the end) and the row is not drawn at all.
        */}
        {rail ? null : (
          <View style={{ flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg }}>
            <HeroAction
              icon={Plus}
              text="New project"
              fill={theme.colors.foreground}
              ink={theme.colors.background}
              onPress={() => router.push("/project-new")}
            />
            <HeroAction
              icon={Camera}
              text="Capture photo"
              fill={theme.colors.accent}
              ink={theme.colors.primary}
              accessibilityHint="Opens the camera on the nearest or most recent job"
              onPress={openCamera}
            />
          </View>
        )}

        {loading ? (
          <SkeletonList rows={4} />
        ) : (
          <>
            {recent.length > 0 ? (
              <>
                <SectionTitle
                  title="Recent jobs"
                  action={{ label: "See all", onPress: () => router.push("/projects") }}
                />
                <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
                  {recent.map((project) => (
                    <JobCard
                      key={project.id}
                      project={project}
                      coverUrl={covers[project.id]}
                      stats={stats[project.id]}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {urgent.length > 0 || queue.failed > 0 ? (
              <>
                <SectionTitle title="Needs attention" />
                <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
                  {queue.failed > 0 ? (
                    <AttentionCard
                      icon={CloudUpload}
                      late
                      title="Some changes did not send"
                      subtitle={`${queue.failed} need attention`}
                      onPress={() => router.push("/queue")}
                    />
                  ) : null}
                  {urgent.slice(0, ATTENTION_CAP).map((task) => (
                    <AttentionCard
                      key={task.id}
                      icon={TriangleAlert}
                      late={bucketOf(task) === "overdue"}
                      title={`${task.title}: ${dueLabel(task.due_date) ?? "Due"}`}
                      subtitle={projectName.get(task.project_id) ?? "A project"}
                      onPress={() =>
                        router.push({
                          pathname: "/task/[id]",
                          params: { id: task.id, projectId: task.project_id },
                        })
                      }
                    />
                  ))}
                  {/*
                    Capped. A home screen longer than a screenful is a task
                    list with a greeting on top, and the task list already
                    exists.
                  */}
                  {urgent.length > ATTENTION_CAP ? (
                    <Text variant="caption" tone="muted">
                      {urgent.length - ATTENTION_CAP} more overdue or due today.
                    </Text>
                  ) : null}
                </View>
              </>
            ) : null}

            {/*
              The photographs, below the things that can actually be lost and
              above everything that is only a shortcut: between "here is the
              work" and "here is a list of screens", the work wins.
            */}
            {stripPhotos.length > 0 ? (
              <>
                <SectionTitle
                  title="Latest photos"
                  action={{ label: "See all", onPress: () => router.push("/gallery") }}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: spacing.lg,
                    gap: spacing.sm,
                  }}
                >
                  {stripPhotos.map((photo) => (
                    <RecentPhoto key={photo.id} photo={photo} uri={stripUrls[photo.id]} />
                  ))}
                </ScrollView>
              </>
            ) : null}

            {/*
              The menu, as a grid rather than a stack of identical rows. These
              are browse surfaces: nobody opens the app at seven in the morning
              to read the activity feed. A grid says "pick one" where rows say
              "work through these".
            */}
            <SectionTitle title="Browse" />
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: spacing.sm,
                paddingHorizontal: spacing.lg,
              }}
            >
              {BROWSE.map((item) => (
                <QuickTile
                  key={item.href}
                  icon={item.icon}
                  label={item.label}
                  onPress={() => router.push(item.href as never)}
                />
              ))}
            </View>
          </>
        )}
      </Screen>

      <ActionRail
        railOnly
        actions={[
          {
            key: "new-project",
            icon: Plus,
            label: "New project",
            onPress: () => router.push("/project-new"),
          },
        ]}
      />
    </View>
  );
}

/**
 * A section heading in sentence case.
 *
 * Not the kit's `SectionHeader`, which sets its title as a small caps overline:
 * right for dividing a settings list, wrong for the few large headings the home
 * mockup reads by. The `See all` link keeps that component's shape and hit
 * slop so the two feel the same under a thumb.
 */
function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        marginTop: spacing.md,
      }}
    >
      <Text variant="heading" accessibilityRole="header" style={{ flex: 1, fontWeight: "700" }}>
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={12}
        >
          <Text variant="caption" tone="primary" style={{ fontWeight: "600" }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One count on the board.
 *
 * `warn` paints the number in the primary orange, and only when it is above
 * zero: a zero in orange would be an alarm about nothing. `null` is "not known
 * yet" and draws a dash rather than a number.
 */
function StatTile({
  label,
  value,
  warn = false,
  format,
  spoken,
  onPress,
}: {
  label: string;
  value: number | null;
  warn?: boolean;
  /** How the number is drawn, when it is not a bare count ("83%"). */
  format?: (value: number) => string;
  /** What a screen reader says instead of "label: value", when words read better. */
  spoken?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const hot = warn && value !== null && value > 0;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "summary"}
      accessibilityLabel={spoken ?? `${label}: ${value ?? "loading"}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        gap: spacing.xs,
        justifyContent: "space-between",
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
      })}
    >
      {/* Two lines, so "Documentation health" is not cut to "Documentati..." */}
      <Text variant="caption" tone="muted" numberOfLines={2} style={{ fontWeight: "600" }}>
        {label}
      </Text>
      <Text variant="display" tone={hot ? "primary" : "default"}>
        {value === null ? "–" : format ? format(value) : value}
      </Text>
    </Pressable>
  );
}

/**
 * One of the two big actions under the counts.
 *
 * Drawn here rather than with `Button` because neither fill is a `Button`
 * variant: one is the inverted ink of the page, the other the peach accent with
 * orange text, and both take half the row.
 */
function HeroAction({
  icon,
  text,
  fill,
  ink,
  accessibilityHint,
  onPress,
}: {
  icon: LucideIcon;
  text: string;
  fill: string;
  ink: string;
  accessibilityHint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 56,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: fill,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon icon={icon} size="md" color={ink} />
      <Text variant="bodyStrong" numberOfLines={1} style={{ color: ink }}>
        {text}
      </Text>
    </Pressable>
  );
}

/**
 * One job in Recent jobs: cover, name, where it is and who for, and its status.
 *
 * The mockup's second line is "city · job type". Projects have no type column,
 * so the second half is the client, which is the other thing a crew knows a job
 * by. The third line is the web's "On site now" detail: how many photos the job
 * has and when the last one was taken, falling back to when the job was last
 * touched while the counts load or when it has no photos.
 */
function JobCard({
  project,
  coverUrl,
  stats,
}: {
  project: ProjectListItem;
  coverUrl?: string;
  stats?: ProjectPhotoStats;
}) {
  const theme = useTheme();
  const name = projectDisplayName(project);
  const place = [project.city, project.state].filter(Boolean).join(", ") || project.location;
  const subtitle = [place, project.client_name].filter(Boolean).join(" · ");
  const status = isProjectStatus(project.status) ? PROJECT_STATUS_LABELS[project.status] : null;
  const tone = isProjectStatus(project.status) ? STATUS_TONE[project.status] : "neutral";
  const when = relativeTime(stats?.lastPhotoAt ?? project.updated_at);
  const activity = stats
    ? [photoCountLabel(stats.photoCount), when].filter(Boolean).join(" · ")
    : when;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, subtitle, activity, status].filter(Boolean).join(", ")}
      onPress={() => router.push({ pathname: "/project/[id]", params: { id: project.id } })}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
      })}
    >
      <PhotoThumb uri={coverUrl} width={JOB_COVER} height={JOB_COVER} rounded={radius.md} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {activity ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {activity}
          </Text>
        ) : null}
      </View>
      {status ? <Badge label={status} tone={tone} variant="soft" /> : null}
    </Pressable>
  );
}

/**
 * One item in Needs attention: an amber card with a warning glyph.
 *
 * `late` turns the glyph red. The card stays amber either way, so the section
 * reads as one block, but overdue work still stands out from work due today.
 */
function AttentionCard({
  icon,
  late,
  title,
  subtitle,
  onPress,
}: {
  icon: LucideIcon;
  late: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.lg,
        // The safety amber at low alpha: `#rrggbbaa`, which React Native reads.
        backgroundColor: `${theme.colors.safety}33`,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {/*
        The accent's ink rather than the safety amber itself, which measures
        under 2:1 on its own tint and would vanish as a glyph.
      */}
      <Icon
        icon={icon}
        size="md"
        color={late ? theme.colors.destructive : theme.colors.accentForeground}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * One destination in the Browse grid.
 *
 * Deliberately a different shape from `ListRow`: an icon over a short label, no
 * subtitle, no chevron. A row and a tile mean different things - a row is a
 * thing to read, a tile is a place to go - and the app had drawn every one of
 * them as a row, which is what made eight screens look like the same settings
 * page.
 */
function QuickTile({
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tile = useBrowseTile();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: tile,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.xs,
        paddingVertical: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
      })}
    >
      <Icon icon={icon} size="lg" tone="primary" />
      <Text variant="caption" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One photograph in the home strip.
 *
 * `PhotoThumb` rather than an `<Image>`, for the reason that component exists:
 * a tile whose signed URL could not be produced draws nothing at all, and a
 * strip of invisible tiles reads as a layout bug rather than as missing files.
 *
 * Tapping opens the job rather than the picture. Somebody glancing at home has
 * recognised the site, not the photograph, and the job is where everything
 * else about it is.
 */
function RecentPhoto({ photo, uri }: { photo: GalleryPhotoItem; uri?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={photo.caption || photo.project_name || "Photo"}
      onPress={() => router.push({ pathname: "/project/[id]", params: { id: photo.project_id } })}
      style={{ width: STRIP_TILE, gap: spacing.xs }}
    >
      <PhotoThumb uri={uri} width={STRIP_TILE} height={STRIP_TILE} rounded={radius.md} />
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {photo.project_name ?? "A project"}
      </Text>
    </Pressable>
  );
}
