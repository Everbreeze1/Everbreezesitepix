import { useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  Building2,
  CircleQuestionMark,
  CreditCard,
  ExternalLink,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Server,
  Sparkles,
  CloudUpload,
  UserPlus,
  Users,
  UserX,
} from "@/ui/icons";
import { View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery } from "@tanstack/react-query";
import { ApiClientError } from "@everlumen/api-client";
import { checkIsPlatformAdmin } from "@/api/admin";
import { getUnreadNotificationCount } from "@/api/notifications";
import { pushStatusLabel } from "@/api/push-view";
import { usePush } from "@/push/use-push";
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
  /*
   * The same hook the authenticated layout mounts. Calling it twice is safe:
   * registration is an upsert keyed on the token, so the second call writes the
   * row the first one already wrote.
   */
  const push = usePush();
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

  /*
   * The staff console row, which a customer must never see.
   *
   * `platform_admins` has no client access by design, so this asks the server
   * and believes the answer. `checkIsPlatformAdmin` returns false on any
   * failure, which is the right direction: hiding the row from a staff member
   * costs them a trip to the web console, and showing it to a customer exposes
   * other customers' reports.
   */
  const adminQuery = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: checkIsPlatformAdmin,
    staleTime: 10 * 60 * 1000,
  });

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
            icon={BellRing}
            iconTone={push.blocked ? "muted" : "primary"}
            title="Push notifications"
            /*
              Named honestly rather than reduced to on/off. "Not available on a
              simulator" and "turned off in your phone settings" send somebody
              to two different places, and collapsing them into "off" sends them
              to the wrong one.
            */
            subtitle={pushStatusLabel(push.blocked, Boolean(push.token))}
            right={
              push.blocked ? (
                <Badge label="Off" tone="neutral" variant="outline" />
              ) : push.token ? (
                <Badge label="On" tone="success" />
              ) : undefined
            }
          />
          <RowDivider />
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
            title="Team"
            subtitle="Invite people, set roles"
            onPress={() => router.push("/team")}
          />
          <RowDivider />
          <ListRow
            icon={UserPlus}
            title="Collaborators"
            subtitle="Outside firms, scoped to named jobs"
            onPress={() => router.push("/collaborators")}
          />
          <RowDivider />
          <ListRow
            icon={Building2}
            title="Workspace settings"
            subtitle="Business profile, labels"
            onPress={() => router.push("/workspace")}
          />
          <RowDivider />
          <ListRow
            icon={LayoutTemplate}
            title="Templates"
            subtitle="The checklists your crews start from"
            onPress={() => router.push("/templates")}
          />
          <RowDivider />
          <ListRow
            icon={Sparkles}
            title="Portfolio"
            subtitle="Your public mini-site of finished work"
            onPress={() => router.push("/portfolio")}
          />
        </ListGroup>
      </View>

      <SectionHeader title="Open on the web" />
      <View style={{ paddingHorizontal: spacing.lg }}>
        <ListGroup>
          <ListRow
            icon={CreditCard}
            title="Plan and billing"
            right={<ExternalLinkMark />}
            disabled={!canOpenWeb}
            onPress={() => void openOnWeb("/pricing")}
          />
        </ListGroup>
      </View>

      {adminQuery.data === true ? (
        <>
          <SectionHeader title="Everlumen staff" />
          <View style={{ paddingHorizontal: spacing.lg }}>
            <ListGroup>
              <ListRow
                icon={LifeBuoy}
                title="Feedback queue"
                subtitle="Read, answer and move customer reports"
                onPress={() => router.push("/admin")}
              />
            </ListGroup>
          </View>
        </>
      ) : null}

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
            subtitle="Send it from here, with the recent errors attached"
            onPress={() => router.push("/report-issue")}
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

      {/*
        Below sign-out, and visually quieter than it. Google requires this route
        to exist and be reachable; it does not require it to be the first thing
        somebody meets on the account screen.
      */}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl }}>
        <ListGroup>
          <ListRow
            icon={UserX}
            iconTone="destructive"
            title="Close my account"
            subtitle="Deletes your account and the work you made"
            destructive
            onPress={() => router.push("/close-account")}
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
              /*
                Unregister before signing out, not after. After, the session is
                already gone and the RLS delete would be refused, leaving the
                phone receiving notifications for somebody who is no longer
                signed in on it.
              */
              await push.unregister();
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
