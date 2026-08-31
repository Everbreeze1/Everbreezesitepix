import { useMemo } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listMyOpenTasks, listRecentCaptureTimes } from "@/api/dashboard";
import {
  bucketOf,
  capturedTodayLabel,
  countToday,
  dueLabel,
  greeting,
  headline,
  needsYou,
} from "@/api/dashboard-view";
import { getUnreadNotificationCount } from "@/api/notifications";
import { listProjects } from "@/api/projects";
import { QueueBanner } from "@/components/QueueBanner";
import { useAuth } from "@/lib/auth";
import { useQueue } from "@/offline/use-queue";
import { contentWidth, gridColumns, radius, spacing, useTheme } from "@/theme";
import {
  Activity,
  Bell,
  Calendar,
  Camera,
  CircleCheck,
  CloudUpload,
  FolderKanban,
  FolderPlus,
  Images,
  MapPin,
  Sparkles,
} from "@/ui/icons";
import {
  Badge,
  Button,
  CountBadge,
  ListGroup,
  Icon,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  type LucideIcon,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Home: what needs you today.
 *
 * Deliberately not the web dashboard. That page is a widget grid of counts, a
 * seven-day sparkline and a documentation-health percentage, which answer "how
 * is the business doing" for somebody at a desk. The person holding this phone
 * is standing on a site at seven in the morning and is asking something else,
 * so this screen answers that instead and loads none of the other.
 *
 * The order is by urgency and it is fixed. Anything the phone still has to send
 * comes first because it is the only item on the screen that can be lost;
 * overdue work comes next; everything after that is a shortcut rather than a
 * demand.
 *
 * This replaced the project list as the first tab, and the project list moved
 * to `projects.tsx` alongside it. Opening onto a list of jobs makes finding a
 * job the first thing the app is for, and it is not: knowing whether anything
 * needs you is.
 */
/**
 * The browse destinations, in the order somebody reaches for them.
 *
 * Map first because it is the only one that answers a question you have while
 * standing outside: which of these am I at.
 */
/**
 * Tile width, measured rather than expressed as a percentage.
 *
 * `width: "32%"` with a gap between them overflows: three tiles plus two gaps
 * came to a few points more than the row, so the third wrapped and the grid
 * silently became two columns. Percentages cannot see the gap; arithmetic can.
 * Same approach the photo grids use.
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

function useBrowseTile(): number {
  const { width } = useWindowDimensions();
  const usable = contentWidth(width) - spacing.lg * 2;
  const columns = gridColumns(usable, BROWSE_TARGET_TILE);
  return (usable - spacing.sm * (columns - 1)) / columns;
}

const BROWSE: { icon: LucideIcon; label: string; href: string }[] = [
  { icon: MapPin, label: "Map", href: "/map" },
  { icon: FolderKanban, label: "Pipelines", href: "/pipelines" },
  { icon: Calendar, label: "Timeline", href: "/timeline" },
  { icon: FolderPlus, label: "Groups", href: "/groups" },
  { icon: Activity, label: "Team", href: "/activity" },
  // Sixth, which the responsive grid absorbs: at a 110pt target a phone still
  // draws three across and a tablet fits all six on one row.
  { icon: Sparkles, label: "Assistant", href: "/assistant" },
];

export default function HomeScreen() {
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

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const urgent = useMemo(() => needsYou(tasks), [tasks]);
  const overdue = urgent.filter((task) => bucketOf(task) === "overdue").length;
  const dueToday = urgent.length - overdue;

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.name);
    return map;
  }, [projects]);

  /*
   * Recently touched, not starred and not all of them. `listProjects` already
   * comes back newest-updated first, so this is the three jobs somebody was
   * actually on, which is what "jump back in" means on a phone.
   */
  const recent = useMemo(
    () => projects.filter((project) => !project.archived).slice(0, 3),
    [projects],
  );

  const unread = unreadQuery.data ?? 0;
  const capturedToday = countToday(capturesQuery.data ?? []);
  const loading = tasksQuery.isLoading || projectsQuery.isLoading;

  const refreshing =
    tasksQuery.isRefetching || projectsQuery.isRefetching || capturesQuery.isRefetching;

  const refresh = () => {
    void tasksQuery.refetch();
    void projectsQuery.refetch();
    void unreadQuery.refetch();
    void capturesQuery.refetch();
  };

  return (
    <Screen scroll padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={96}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, gap: 2 }}>
        <Text variant="title">{greeting()}</Text>
        <Text variant="caption" tone="muted">
          {/*
            One line, and the most pressing thing rather than every count. A
            summary that recites four numbers is a fifth thing to read.
          */}
          {headline({ overdue, dueToday, unread, queued: queue.outstanding })}
        </Text>
      </View>

      {/*
        The queue first, always. It is the only thing on this screen that can
        actually be lost, and it is the one piece of state no server knows about.
      */}
      {/*
        The wrapper is conditional, not just the banner.
       
        `QueueBanner` returns null when the queue is clear, but its padding did
        not: an empty view kept `paddingTop: lg` plus the gap either side, which
        on a clear queue - the normal state - left a band of nothing between the
        greeting and the first thing to read.
      */}
      {queue.outstanding > 0 ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
          <QueueBanner />
        </View>
      ) : null}

      {loading ? (
        <SkeletonList rows={5} />
      ) : (
        <>
          {urgent.length > 0 ? (
            <>
              <SectionHeader title={`Needs you (${urgent.length})`} />
              <View style={{ paddingHorizontal: spacing.lg }}>
                <ListGroup>
                  {urgent.slice(0, 6).map((task, index) => {
                    const late = bucketOf(task) === "overdue";
                    return (
                      <View key={task.id}>
                        {index > 0 ? <RowDivider /> : null}
                        <ListRow
                          icon={CircleCheck}
                          iconTone={late ? "destructive" : "safety"}
                          title={task.title}
                          subtitle={projectName.get(task.project_id) ?? "A project"}
                          right={
                            <Badge
                              label={dueLabel(task.due_date) ?? "Due"}
                              tone={late ? "danger" : "warning"}
                              variant="soft"
                            />
                          }
                          onPress={() =>
                            router.push({
                              pathname: "/task/[id]",
                              params: { id: task.id, projectId: task.project_id },
                            })
                          }
                        />
                      </View>
                    );
                  })}
                </ListGroup>
                {/*
                  Capped at six. A home screen longer than a screenful is a task
                  list with a greeting on top, and the task list already exists.
                */}
                {urgent.length > 6 ? (
                  <Text variant="caption" tone="muted" style={{ paddingTop: spacing.sm }}>
                    {urgent.length - 6} more overdue or due today.
                  </Text>
                ) : null}
              </View>
            </>
          ) : null}

          {/*
            "Today" used to carry seven identical rows, five of which were not
            today at all: Map, Groups, Pipelines, Timeline and the activity feed
            are the app's menu, and calling them Today made the heading a lie
            and the screen a wall. Split by what the thing actually is.
          */}
          <SectionHeader title="Today" />
          <View style={{ paddingHorizontal: spacing.lg }}>
            <ListGroup>
              <ListRow
                icon={Camera}
                title="Capture a photo"
                subtitle={capturedTodayLabel(capturedToday)}
                onPress={() => router.push("/capture-start")}
              />
              <RowDivider />
              <ListRow
                icon={Bell}
                title="Notifications"
                subtitle={unread === 0 ? "Nothing unread" : `${unread} unread`}
                right={unread > 0 ? <CountBadge count={unread} tone="primary" /> : undefined}
                unread={unread > 0}
                onPress={() => router.push("/notifications")}
              />
            </ListGroup>
          </View>

          {/*
            The menu, as a grid rather than a seventh identical row.
           
            These five are browse surfaces: nobody opens the app at seven in the
            morning to read the activity feed. A grid says "pick one" where a
            stack of rows says "work through these", and it costs a third of the
            height, which is the difference between Home ending above the fold
            and running off it.
          */}
          <SectionHeader title="Browse" />
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

          {recent.length > 0 ? (
            <>
              <SectionHeader title="Jump back in" />
              <View style={{ paddingHorizontal: spacing.lg }}>
                <ListGroup>
                  {recent.map((project, index) => (
                    <View key={project.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={FolderKanban}
                        title={project.name}
                        subtitle={project.client_name ?? project.city ?? undefined}
                        onPress={() =>
                          router.push({ pathname: "/project/[id]", params: { id: project.id } })
                        }
                      />
                    </View>
                  ))}
                </ListGroup>
              </View>
            </>
          ) : null}

          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.sm }}>
            <Button
              label="All projects"
              icon={FolderKanban}
              variant="secondary"
              fullWidth
              onPress={() => router.push("/projects")}
            />
            <Button
              label="All photos"
              icon={Images}
              variant="ghost"
              fullWidth
              onPress={() => router.push("/gallery")}
            />
          </View>

          {queue.failed > 0 ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
              <ListGroup>
                <ListRow
                  icon={CloudUpload}
                  iconTone="destructive"
                  title="Some changes did not send"
                  subtitle={`${queue.failed} need attention`}
                  onPress={() => router.push("/queue")}
                />
              </ListGroup>
            </View>
          ) : null}
        </>
      )}
    </Screen>
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
