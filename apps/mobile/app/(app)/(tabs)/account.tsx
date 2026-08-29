import { useEffect, useState } from "react";
import {
  Bell,
  Building2,
  CircleQuestionMark,
  CreditCard,
  ExternalLink,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Server,
  CloudUpload,
  Users,
} from "@/ui/icons";
import { View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery } from "@tanstack/react-query";
import { ApiClientError } from "@everlumen/api-client";
import { getUnreadNotificationCount } from "@/api/notifications";
import { api, webAppLink } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useQueue } from "@/offline/use-queue";
import { spacing } from "@/theme";
import {
  Avatar,
  Badge,
  Button,
  CountBadge,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Text,
} from "@/ui";

/**
 * The account tab, and the app's honest boundary with the web app.
 *
 * This screen used to be an email address, a health string and a sign-out
 * button. Everything else a person might want (their team, their templates,
 * their plan) had no route from the phone at all, which reads as the features
 * not existing rather than living somewhere else.
 *
 * The rows below are in two groups on purpose. The first group is native: the
 * upload queue is the one piece of app state only the phone knows about, so it
 * cannot be delegated. The second group opens the web app in the system
 * browser, because the parity matrix marks those surfaces web-only and a
 * half-built phone version of a report builder is worse than a link to the real
 * one. Every row in that group carries the same external-link glyph, so nobody
 * taps one expecting to stay inside the app.
 */
export default function AccountScreen() {
  const { user, signOut } = useAuth();
  const queue = useQueue();
  const [health, setHealth] = useState<string | null>(null);
  const [healthy, setHealthy] = useState<boolean | null>(null);

  /*
   * The unread count on the notifications row.
   *
   * Its own query rather than a slice of the inbox list, because the count has
   * to be right without having loaded a page of notifications: someone who has
   * never opened the inbox should still see that four things are waiting. The
   * inbox invalidates this key whenever it marks anything read.
   */
  const unreadQuery = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: getUnreadNotificationCount,
    // A badge one minute stale is fine; refetching it on every tab focus is
    // a request per glance at the account screen.
    staleTime: 60_000,
  });
  const unread = unreadQuery.data ?? 0;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.health();
        if (cancelled) return;
        setHealth(`${res.service} ${res.version}`);
        setHealthy(true);
      } catch (e) {
        if (cancelled) return;
        setHealth(
          e instanceof ApiClientError
            ? `${e.code}: ${e.message}`
            : e instanceof Error
              ? e.message
              : "Health check failed",
        );
        setHealthy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openOnWeb(path: string) {
    const url = webAppLink(path);
    // No configured origin is a build misconfiguration, not something the user
    // did. Silently doing nothing would look like a dead row, so the row is
    // disabled instead and never reaches here.
    if (!url) return;
    await WebBrowser.openBrowserAsync(url);
  }

  const canOpenWeb = webAppLink("/") !== null;
  // `outstanding` is the queue own count of everything not yet delivered,
  // which already folds in rows mid-send. Adding pending and failed by hand
  // here would drop whatever is in flight at that moment.
  const pending = queue.outstanding;

  return (
    <Screen scroll padded={false} bottomInset={80}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.lg,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xxl,
        }}
      >
        <Avatar name={user?.email ?? null} size="lg" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" numberOfLines={1}>
            {user?.email ?? "Signed in"}
          </Text>
          <Text variant="caption" tone="muted">
            Everlumen field app
          </Text>
        </View>
      </View>

      <SectionHeader title="Inbox" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <ListGroup>
          <ListRow
            icon={Bell}
            title="Notifications"
            subtitle={unread === 0 ? "Assignments, mentions and completions" : `${unread} unread`}
            right={unread > 0 ? <CountBadge count={unread} tone="primary" /> : undefined}
            unread={unread > 0}
            onPress={() => router.push("/notifications")}
          />
        </ListGroup>
      </View>

      <SectionHeader title="On this phone" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <ListGroup>
          <ListRow
            icon={CloudUpload}
            iconTone={queue.failed > 0 ? "destructive" : "primary"}
            title="Upload queue"
            subtitle={
              pending === 0
                ? "Everything is uploaded"
                : queue.failed > 0
                  ? `${queue.failed} need attention`
                  : `${queue.pending} waiting to send`
            }
            right={<CountBadge count={pending} tone={queue.failed > 0 ? "danger" : "primary"} />}
            onPress={() => router.push("/queue")}
          />
        </ListGroup>
      </View>

      <SectionHeader title="Workspace" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <ListGroup>
          <ListRow
            icon={Users}
            title="Team and collaborators"
            subtitle="Invite people, set roles"
            onPress={() => router.push("/team")}
          />
          <RowDivider />
          <ListRow
            icon={Building2}
            title="Workspace settings"
            subtitle="Business profile, labels"
            onPress={() => router.push("/workspace")}
          />
        </ListGroup>
      </View>

      <SectionHeader title="Open on the web" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <ListGroup>
          <ListRow
            icon={LayoutTemplate}
            title="Templates and blueprints"
            subtitle="Checklists, workflows, reports"
            right={<ExternalLinkMark />}
            disabled={!canOpenWeb}
            onPress={() => void openOnWeb("/templates")}
          />
          <RowDivider />
          <ListRow
            icon={CreditCard}
            title="Plan and billing"
            right={<ExternalLinkMark />}
            disabled={!canOpenWeb}
            onPress={() => void openOnWeb("/pricing")}
          />
        </ListGroup>
      </View>

      <SectionHeader title="Help" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <ListGroup>
          <ListRow
            icon={CircleQuestionMark}
            title="Knowledge base"
            right={<ExternalLinkMark />}
            disabled={!canOpenWeb}
            onPress={() => void openOnWeb("/help")}
          />
          <RowDivider />
          <ListRow
            icon={LifeBuoy}
            title="Report a problem"
            right={<ExternalLinkMark />}
            disabled={!canOpenWeb}
            onPress={() => void openOnWeb("/report-issue")}
          />
          <RowDivider />
          {/*
           * The health probe stays. It is the fastest way to tell "the app is
           * broken" apart from "this phone has no route to the API", which is
           * the question support actually has to answer first.
           */}
          <ListRow
            icon={Server}
            title="API status"
            subtitle={health ?? "Checking"}
            right={
              healthy === null ? null : (
                <Badge label={healthy ? "OK" : "Down"} tone={healthy ? "success" : "danger"} />
              )
            }
          />
        </ListGroup>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl }}>
        <Button
          label="Sign out"
          variant="destructive"
          icon={LogOut}
          fullWidth
          onPress={() => {
            void (async () => {
              await signOut();
              router.replace("/login");
            })();
          }}
        />
      </View>
    </Screen>
  );
}

/** The glyph every web-bound row carries, so the boundary is visible at a glance. */
function ExternalLinkMark() {
  return <Badge label="Web" icon={ExternalLink} tone="neutral" variant="outline" />;
}
