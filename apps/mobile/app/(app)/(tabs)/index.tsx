import { useMemo } from "react";
import { View } from "react-native";
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
import { spacing } from "@/theme";
import {
  Activity,
  Bell,
  Camera,
  CircleCheck,
  CloudUpload,
  FolderKanban,
  Images,
  MapPin,
} from "@/ui/icons";
import {
  Badge,
  Button,
  CountBadge,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
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
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <QueueBanner />
      </View>

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
              <RowDivider />
              <ListRow
                icon={MapPin}
                title="Map"
                subtitle="Every job with a location, nearest first"
                onPress={() => router.push("/map")}
              />
              <RowDivider />
              <ListRow
                icon={Activity}
                title="What the team did"
                subtitle="Photos, tasks and reports across the crew"
                /*
                  Activity used to be a tab of its own. It moved here because it
                  is a browse surface: it answers what everyone else has been
                  doing, which nobody opens the app at seven in the morning to
                  find out. Losing the tab kept the camera centred between four.
                */
                onPress={() => router.push("/activity")}
              />
            </ListGroup>
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
