import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  addUserNote,
  deletePlatformUser,
  getPlatformUserDetail,
  listUserNotes,
  overrideTeamPlan,
  runUserSupportAction,
  setAdminRole,
  setUserTeamRole,
  type PlatformUserDetail,
  type UserSupportAction,
} from "@/api/admin";
import { ADMIN_ROLE_COPY, formatBytes, PLANS, TEAM_ROLES } from "@/api/admin-view";
import {
  AdminGate,
  CapabilityNotice,
  StatGrid,
  StatTile,
  useAdminCan,
  useReasonPrompt,
} from "@/components/admin/AdminKit";
import type { AdminRole } from "@/lib/access";
import { spacing } from "@/theme";
import { Ban, CircleCheck, KeyRound, Mail, Trash2 } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One account, with everything the web's user page can do to it.
 *
 * Support actions (password reset, resend confirmation, suspend, reinstate,
 * delete), the team's plan and complimentary access, platform access, internal
 * notes, the person's role inside each team, and their projects and feedback.
 * Every write asks for a reason first, and each control a role cannot use says
 * so rather than failing with a 403.
 */
export default function AdminUserScreen() {
  return (
    <AdminGate title="Account">
      <UserDetail />
    </AdminGate>
  );
}

function UserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { denyReason } = useAdminCan();
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const query = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: () => getPlatformUserDetail(id),
    enabled: Boolean(id),
  });
  const notesQuery = useQuery({
    queryKey: ["admin", "user-notes", id],
    queryFn: () => listUserNotes(id),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "user", id] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  };
  const { ask, sheet } = useReasonPrompt((error) => {
    if (!error) refresh();
  });

  const user = query.data;
  if (query.isLoading) return <SkeletonList rows={6} />;
  if (query.error || !user) {
    return (
      <ErrorState
        title="Could not load this account"
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const deniedSupport = denyReason("support");
  const deniedOwner = denyReason("owner");
  const deniedBilling = denyReason("billing");
  const suspended = Boolean(
    user.auth?.bannedUntil && new Date(user.auth.bannedUntil).getTime() > Date.now(),
  );

  const support = (action: UserSupportAction, title: string, description: string) =>
    ask({
      title,
      description,
      confirmLabel: "Continue",
      run: async (reason) => setMessage(await runUserSupportAction(user.id, action, reason)),
    });

  const saveNote = async () => {
    if (note.trim().length < 1) return;
    setNoteBusy(true);
    try {
      await addUserNote(user.id, note.trim());
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "user-notes", id] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The note was not saved.");
    } finally {
      setNoteBusy(false);
    }
  };

  const changePlan = (
    team: PlatformUserDetail["teams"][number],
    next: { plan?: (typeof PLANS)[number]; isInternal?: boolean },
  ) =>
    ask({
      title:
        next.plan !== undefined
          ? `Move ${team.name} to the ${next.plan} plan?`
          : next.isInternal
            ? `Give ${team.name} complimentary access?`
            : `Remove complimentary access from ${team.name}?`,
      description: `${
        team.memberCount > 1
          ? `This changes the plan for all ${team.memberCount} members of ${team.name}.`
          : `${team.name} has one member.`
      } It writes our own database and does not touch Stripe.`,
      confirmLabel: "Change plan",
      run: (reason) => overrideTeamPlan({ teamId: team.id, ...next, reason }),
    });

  const changeAdmin = (role: AdminRole | null) =>
    ask({
      title: role === null ? "Revoke platform admin?" : `Grant ${role} access?`,
      description:
        role === null
          ? "They lose the admin console immediately."
          : `${ADMIN_ROLE_COPY[role]}. Takes effect on their next request.`,
      confirmLabel: role === null ? "Revoke" : "Grant",
      destructive: role === null,
      run: (reason) => setAdminRole(user.id, role, reason),
    });

  return (
    <>
      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
          <Text variant="title">{user.fullName || user.email || "Unnamed account"}</Text>
          <Text variant="caption" tone="muted">
            {[user.email, user.company, user.jobTitle].filter(Boolean).join(" · ")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {suspended ? <Badge label="Suspended" tone="danger" /> : null}
            {user.auth?.emailConfirmedAt ? (
              <Badge label="Email confirmed" tone="success" />
            ) : (
              <Badge label="Unconfirmed" tone="warning" />
            )}
            {user.adminRole ? <Badge label={`Admin: ${user.adminRole}`} tone="primary" /> : null}
          </View>
          <Text variant="caption" tone="muted">
            Joined {relativeTime(user.createdAt)}
            {user.auth?.lastSignInAt
              ? `, last signed in ${relativeTime(user.auth.lastSignInAt)}`
              : ""}
            {user.auth?.provider ? `, via ${user.auth.provider}` : ""}
          </Text>
          {message ? <Text variant="caption">{message}</Text> : null}
          <StatGrid>
            <StatTile label="Projects" value={String(user.totals.projects)} />
            <StatTile label="Photos" value={String(user.totals.photos)} />
            <StatTile label="Storage" value={formatBytes(user.totals.storageBytes)} />
            <StatTile label="Feedback" value={String(user.totals.feedbackReports)} />
          </StatGrid>
        </View>

        <SectionHeader title="Support actions" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <Button
            label="Send password reset"
            icon={KeyRound}
            variant="secondary"
            fullWidth
            disabled={Boolean(deniedSupport) || !user.email}
            onPress={() =>
              support(
                "send_password_reset",
                "Send a password reset",
                `A reset link will be emailed to ${user.email}.`,
              )
            }
          />
          <Button
            label="Resend confirmation"
            icon={Mail}
            variant="secondary"
            fullWidth
            disabled={Boolean(deniedSupport) || Boolean(user.auth?.emailConfirmedAt)}
            onPress={() =>
              support(
                "resend_confirmation",
                "Resend the confirmation email",
                `A new confirmation link will be emailed to ${user.email}.`,
              )
            }
          />
          {suspended ? (
            <Button
              label="Reinstate"
              icon={CircleCheck}
              variant="secondary"
              fullWidth
              disabled={Boolean(deniedSupport)}
              onPress={() =>
                support(
                  "reinstate",
                  "Reinstate this account",
                  "They can sign in again immediately.",
                )
              }
            />
          ) : (
            <Button
              label="Suspend"
              icon={Ban}
              variant="secondary"
              fullWidth
              disabled={Boolean(deniedSupport)}
              onPress={() =>
                support(
                  "suspend",
                  "Suspend this account",
                  "They are signed out and cannot sign in. Reversible from here.",
                )
              }
            />
          )}
          <Button
            label="Delete account"
            icon={Trash2}
            variant="destructive"
            fullWidth
            disabled={Boolean(deniedOwner) || !user.email}
            onPress={() =>
              ask({
                title: "Delete this account",
                description:
                  "This cannot be undone. Their projects are not deleted; they stay, attributed to a user who no longer exists.",
                confirmLabel: "Delete account",
                destructive: true,
                confirmEmail: user.email,
                run: async (reason, typed) => {
                  const orphaned = await deletePlatformUser(user.id, reason, typed);
                  void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
                  setMessage(
                    orphaned ? `Deleted. ${orphaned} project(s) are now unattributed.` : "Deleted.",
                  );
                  router.back();
                },
              })
            }
          />
          <CapabilityNotice reason={deniedSupport ?? deniedOwner} />
        </View>

        <SectionHeader title="Plan" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {user.teams.length === 0 ? (
            <Text variant="caption" tone="muted">
              This account belongs to no team, and plans belong to teams, so there is nothing to
              change here.
            </Text>
          ) : (
            user.teams.map((team) => (
              <Card key={team.id} onPress={() => router.push(`/admin/team/${team.id}`)}>
                <View style={{ gap: spacing.sm }}>
                  <Text variant="bodyStrong">{team.name}</Text>
                  <Text variant="caption" tone="muted">
                    {team.plan} · {team.subscriptionStatus}
                    {team.isInternal ? " · complimentary" : ""} · {team.memberCount} member
                    {team.memberCount === 1 ? "" : "s"}
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                    {PLANS.map((plan) => (
                      <Chip
                        key={plan}
                        label={plan}
                        selected={team.plan === plan}
                        onPress={
                          deniedBilling || team.plan === plan
                            ? undefined
                            : () => changePlan(team, { plan })
                        }
                      />
                    ))}
                    <Chip
                      label={team.isInternal ? "Remove complimentary" : "Make complimentary"}
                      onPress={
                        deniedBilling
                          ? undefined
                          : () => changePlan(team, { isInternal: !team.isInternal })
                      }
                    />
                  </View>
                </View>
              </Card>
            ))
          )}
          <CapabilityNotice reason={user.teams.length ? deniedBilling : null} />
        </View>

        <SectionHeader title="Platform access" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <Text variant="caption" tone="muted">
            {user.adminRole
              ? `Currently ${user.adminRole}.`
              : "Not a platform admin. Granting access lets them read every customer's data."}
          </Text>
          <ListGroup>
            {(["support", "billing", "superadmin"] as const).map((role, index) => (
              <View key={role}>
                {index > 0 ? <RowDivider inset={false} /> : null}
                <ListRow
                  title={role}
                  subtitle={ADMIN_ROLE_COPY[role]}
                  value={user.adminRole === role ? "Current" : undefined}
                  chevron={false}
                  disabled={Boolean(deniedOwner) || user.adminRole === role}
                  onPress={() => changeAdmin(role)}
                />
              </View>
            ))}
          </ListGroup>
          {user.adminRole ? (
            <Button
              label="Revoke platform admin"
              variant="outline"
              disabled={Boolean(deniedOwner)}
              onPress={() => changeAdmin(null)}
            />
          ) : null}
          <CapabilityNotice reason={deniedOwner} />
        </View>

        {user.teams.length > 0 ? (
          <>
            <SectionHeader title="Team membership" />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              {user.teams.map((team) => (
                <Card key={team.id}>
                  <View style={{ gap: spacing.sm }}>
                    <Text variant="bodyStrong">{team.name}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                      {TEAM_ROLES.map((role) => (
                        <Chip
                          key={role}
                          label={role}
                          selected={team.role === role}
                          onPress={
                            deniedSupport || team.role === role
                              ? undefined
                              : () =>
                                  ask({
                                    title: `Set role to ${role} in ${team.name}?`,
                                    description:
                                      role === "owner"
                                        ? "Owners manage billing and remove members. Use this to recover a team whose owner has left."
                                        : "This changes what they can do inside that team, immediately.",
                                    confirmLabel: "Change role",
                                    run: (reason) =>
                                      setUserTeamRole(user.id, team.id, role, reason),
                                  })
                          }
                        />
                      ))}
                    </View>
                  </View>
                </Card>
              ))}
              <CapabilityNotice reason={deniedSupport} />
            </View>
          </>
        ) : null}

        <SectionHeader title="Internal notes" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {(notesQuery.data ?? []).map((n) => (
            <Card key={n.id}>
              <View style={{ gap: 2 }}>
                <Text variant="body">{n.body}</Text>
                <Text variant="caption" tone="muted">
                  {n.author.name || n.author.email || "An admin"} · {relativeTime(n.createdAt)}
                </Text>
              </View>
            </Card>
          ))}
          <Field
            value={note}
            onChangeText={setNote}
            placeholder="A note only staff can read"
            multiline
            rows={2}
            editable={!deniedSupport}
          />
          <Button
            label="Save note"
            variant="secondary"
            disabled={noteBusy || Boolean(deniedSupport) || !note.trim()}
            onPress={() => void saveNote()}
          />
        </View>

        {user.projects.length > 0 ? (
          <>
            <SectionHeader title="Projects" count={user.projects.length} />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                {user.projects.slice(0, 50).map((project, index) => (
                  <View key={project.id}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={project.name}
                      subtitle={`${project.status} · ${project.photoCount} photos${project.deletedAt ? " · in trash" : ""}`}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          </>
        ) : null}

        {user.feedback.length > 0 ? (
          <>
            <SectionHeader title="Feedback they sent" count={user.feedback.length} />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                {user.feedback.map((report, index) => (
                  <View key={report.id}>
                    {index > 0 ? <RowDivider inset={false} /> : null}
                    <ListRow
                      title={report.description?.slice(0, 80) || report.kind}
                      subtitle={`${report.kind} · ${report.status} · ${relativeTime(report.createdAt)}`}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          </>
        ) : null}
      </Screen>
      {sheet}
    </>
  );
}
