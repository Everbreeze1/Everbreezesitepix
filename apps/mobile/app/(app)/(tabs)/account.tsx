import { useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  Building2,
  ChevronLeft,
  CircleQuestionMark,
  CreditCard,
  ExternalLink,
  LayoutTemplate,
  KeyRound,
  LifeBuoy,
  LogOut,
  Mail,
  Palette,
  Server,
  Sparkles,
  Trash2,
  CloudUpload,
  UserPlus,
  Users,
  UserRound,
  UserX,
} from "@/ui/icons";
import { View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { useQuery } from "@tanstack/react-query";
import { ApiClientError } from "@everlumen/api-client";
import { getMyProfile } from "@/api/profile";
import { getUnreadNotificationCount } from "@/api/notifications";
import { getTrashCounts } from "@/api/trash";
import { pushStatusLabel } from "@/api/push-view";
import { usePush } from "@/push/use-push";
import { api, webAppLink } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAccountOwner, usePlatformAdmin } from "@/lib/use-access";
import { useQueue } from "@/offline/use-queue";
import { useTabBack } from "@/lib/navigation";
import { spacing } from "@/theme";
import {
  Avatar,
  Badge,
  Button,
  CountBadge,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  Columns,
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
  const tabBack = useTabBack();
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
  const trashCounts = useQuery({
    queryKey: ["trash-counts"],
    queryFn: getTrashCounts,
    // Cheap and rarely changing. Stale for a minute keeps the Account screen
    // from firing it on every tab switch.
    staleTime: 60_000,
  });

  const unreadQuery = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: getUnreadNotificationCount,
    // A badge one minute stale is fine; refetching it on every tab focus is
    // a request per glance at the account screen.
    staleTime: 60_000,
  });
  const unread = unreadQuery.data ?? 0;

  /*
   * The profile row, for the name and picture at the top. The same row the
   * Profile screen edits, under the same key, so a save there shows here on
   * the way back.
   */
  const profileQuery = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: () => getMyProfile(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
  });
  const profileName = profileQuery.data?.full_name?.trim() || null;

  /*
   * The staff console row, which a customer must never see.
   *
   * `platform_admins` has no client access by design, so this asks the server
   * and believes the answer. `checkIsPlatformAdmin` returns false on any
   * failure, which is the right direction: hiding the row from a staff member
   * costs them a trip to the web console, and showing it to a customer exposes
   * other customers' reports.
   */
  const { isAdmin } = usePlatformAdmin();
  // The Portfolio row is the owner's, as it is in the menu. See `lib/access.ts`.
  const { isOwner } = useAccountOwner();

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
        {/* Only when reached from another tab or the menu; see `useTabBack`. */}
        {tabBack ? (
          <IconButton
            icon={ChevronLeft}
            accessibilityLabel="Back"
            surface={false}
            onPress={tabBack}
          />
        ) : null}
        <Avatar
          name={profileName ?? user?.email ?? null}
          uri={profileQuery.data?.avatar_url}
          size="lg"
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" numberOfLines={1}>
            {profileName ?? user?.email ?? "Signed in"}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {profileName ? (user?.email ?? "") : "Everlumen field app"}
          </Text>
        </View>
      </View>

      {/*
        The web Settings page's personal sections, native: they are four
        screens of switches and fields, and none of them needs a browser.
      */}
      {/*
        Upright, one scroll of sections as before. On its side the
        sections sit in columns, so the screen is not one long list with
        empty margins either side.
      */}
      <Columns minColumn={340} gap={spacing.md} base={spacing.lg}>
        <View style={{ gap: spacing.md }}>
          <SectionHeader title="You" />
          <View style={{ paddingHorizontal: spacing.lg }}>
            <ListGroup>
              <ListRow
                icon={UserRound}
                title="Profile"
                subtitle="Name, job title and picture"
                onPress={() => router.push("/settings/profile")}
              />
              <RowDivider />
              <ListRow
                icon={Mail}
                title="Email notifications"
                subtitle="Assignments, mentions, copied in, work done"
                onPress={() => router.push("/settings/notification-preferences")}
              />
              <RowDivider />
              <ListRow
                icon={KeyRound}
                title="Email and password"
                subtitle="How you sign in"
                onPress={() => router.push("/settings/security")}
              />
              <RowDivider />
              <ListRow
                icon={Palette}
                title="Appearance"
                subtitle="Light, dark or match the phone"
                onPress={() => router.push("/settings/appearance")}
              />
            </ListGroup>
          </View>
        </View>
        <View style={{ gap: spacing.md }}>
          <SectionHeader title="Inbox" />
          <View style={{ paddingHorizontal: spacing.lg }}>
            <ListGroup>
              <ListRow
                icon={Bell}
                title="Notifications"
                subtitle={
                  unread === 0 ? "Assignments, mentions and completions" : `${unread} unread`
                }
                right={unread > 0 ? <CountBadge count={unread} tone="primary" /> : undefined}
                unread={unread > 0}
                onPress={() => router.push("/notifications")}
              />
            </ListGroup>
          </View>
        </View>
        <View style={{ gap: spacing.md }}>
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
                right={
                  <CountBadge count={pending} tone={queue.failed > 0 ? "danger" : "primary"} />
                }
                onPress={() => router.push("/queue")}
              />
              <RowDivider />
              {/*
            Next to the upload queue, because both answer "where did my work
            go". A job deleted on the web could not be found from the phone at
            all until now, let alone put back.
          */}
              <ListRow
                icon={Trash2}
                title="Trash"
                subtitle={
                  trashCounts.data
                    ? trashCounts.data.projects === 0
                      ? "Nothing deleted"
                      : `${trashCounts.data.projects} project${trashCounts.data.projects === 1 ? "" : "s"}, recoverable for 60 days`
                    : "Deleted projects, recoverable for 60 days"
                }
                right={
                  trashCounts.data?.projects ? (
                    <CountBadge count={trashCounts.data.projects} tone="neutral" />
                  ) : undefined
                }
                onPress={() => router.push("/trash")}
              />
            </ListGroup>
          </View>
        </View>
        <View style={{ gap: spacing.md }}>
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
                icon={Palette}
                title="Company"
                subtitle="Logo, watermark, contact details, storage"
                onPress={() => router.push("/settings/company")}
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
              {isOwner ? (
                <>
                  <RowDivider />
                  <ListRow
                    icon={Sparkles}
                    title="Portfolio"
                    subtitle="Your public mini-site of finished work"
                    onPress={() => router.push("/portfolio")}
                  />
                </>
              ) : null}
            </ListGroup>
          </View>
        </View>
        <View style={{ gap: spacing.md }}>
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
        </View>
        <View style={{ gap: spacing.md }}>
          {isAdmin ? (
            <>
              <SectionHeader title="Everlumen staff" />
              <View style={{ paddingHorizontal: spacing.lg }}>
                <ListGroup>
                  <ListRow
                    icon={Server}
                    title="Admin console"
                    subtitle="Users, teams, feedback, health and security"
                    onPress={() => router.push("/admin")}
                  />
                </ListGroup>
              </View>
            </>
          ) : null}
        </View>
        <View style={{ gap: spacing.md }}>
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
        </View>
        <View style={{ gap: spacing.md }}>
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
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: spacing.xl,
            }}
          >
            <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>
              {buildLabel()}
            </Text>
          </View>
        </View>
      </Columns>
    </Screen>
  );
}

/** The glyph every web-bound row carries, so the boundary is visible at a glance. */
function ExternalLinkMark() {
  return <Badge label="Web" icon={ExternalLink} tone="neutral" variant="outline" />;
}

/** "Version 0.1.0 (build 7) · 2026-09-29 21:40 UTC · a42bf8a", so testers can confirm the installed build. */
function buildLabel(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { buildCommit?: string; builtAt?: string };
  const parts = [`Version ${Constants.expoConfig?.version ?? "?"}`];
  const code = Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber;
  if (code) parts[0] += ` (build ${code})`;
  if (extra.builtAt) parts.push(`${extra.builtAt} UTC`);
  if (extra.buildCommit) parts.push(extra.buildCommit);
  return parts.join(" · ");
}
