import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignableRoles,
  can,
  normaliseRole,
  roleDescriptionForTier,
  roleLabelForTier,
  type AssignableRole,
} from "@everlumen/shared/team-permissions";
import {
  getMyTeam,
  inviteMember,
  leaveTeam,
  removeMember,
  resendInvite,
  resendMemberConfirmation,
  revokeInvite,
  updateMemberRole,
  type MyTeam,
} from "@/api/team";
import {
  inviteBlockedReason,
  inviteEmailError,
  isInviteExpired,
  memberActions,
  memberName,
  memberSubtitle,
  rosterEmptyBody,
  seatSummary,
  seatsUsed,
  type TeamInvite,
  type TeamMember,
} from "@/api/team-roster";
import { useAuth } from "@/lib/auth";
import { spacing } from "@/theme";
import { LogOut, Send, TriangleAlert, UserPlus, Users, UserX } from "@/ui/icons";
import {
  ActionSheet,
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
  type SheetAction,
} from "@/ui";

/**
 * Team administration on the phone.
 *
 * This was one of four rows on the account screen that opened the web app in a
 * browser, and it was the wrong one to delegate. Everything behind it is a list
 * of people and four verbs, none of which needs a large screen, and the person
 * who actually needs it is a foreman standing in front of a subcontractor who
 * cannot see the job.
 *
 * The gating is the delicate part and it is not reinvented here.
 * `canManageMember`, `assignableRoles` and `can` come from `@everlumen/shared`
 * and are the same functions the web app and the API gate on. What this screen
 * adds is that a control the caller may not use is **hidden with its reason
 * stated**, rather than shown and then refused by the server. A disabled button
 * with no explanation is how a plan gate comes to read as a bug.
 */

const QUERY_KEY = ["my-team"] as const;

export default function TeamScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [actionsFor, setActionsFor] = useState<TeamMember | null>(null);
  const [roleFor, setRoleFor] = useState<TeamMember | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getMyTeam });
  const data: MyTeam | undefined = query.data;

  const members = useMemo(() => data?.members ?? [], [data]);
  const invites = useMemo(() => data?.invites ?? [], [data]);
  const plan = data?.plan ?? "starter";
  const myRole = data?.myRole ?? null;
  const used = seatsUsed(members.length, invites.length);
  const limit = data?.memberLimit ?? 2;

  const blocked = inviteBlockedReason(myRole, used, limit);
  const canManageUsers = can(myRole, "manage_users") || can(myRole, "manage_own_crew");

  /**
   * Every write refetches the roster rather than patching it optimistically.
   *
   * Deliberate, and the opposite of what the capture screens do. A role change
   * can cascade (removing a member detaches their project assignments; an
   * invite consumes a seat) and the server is the only thing that knows the
   * result. Guessing here would show a roster that disagrees with reality, on
   * the one screen where being wrong about who can do what actually matters.
   */
  const run = useMutation({
    mutationFn: async (work: () => Promise<void>) => work(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not work."),
  });

  const submitInvite = useCallback(() => {
    const error = inviteEmailError(inviteEmail, members, invites);
    if (error) {
      setInviteError(error);
      return;
    }
    setInviteError(null);
    setInviteOpen(false);
    const email = inviteEmail.trim().toLowerCase();
    const role = inviteRole;
    setInviteEmail("");
    run.mutate(() => inviteMember(email, role));
  }, [inviteEmail, inviteRole, members, invites, run]);

  /**
   * Removal asks first, and names the person.
   *
   * `Alert.alert` and not the app's own sheet: this is the one interaction
   * where the platform's own confirm is the right answer, because it is modal
   * in a way a sheet is not and cannot be dismissed by a stray tap outside it.
   */
  const confirmRemove = useCallback(
    (member: TeamMember) => {
      Alert.alert(
        `Remove ${memberName(member)}?`,
        "They lose access to every project in this workspace. Their photos and notes stay.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => run.mutate(() => removeMember(member.id)),
          },
        ],
      );
    },
    [run],
  );

  const confirmLeave = useCallback(() => {
    Alert.alert(
      "Leave this team?",
      "You lose access to every project in this workspace. An owner or admin has to invite you back.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => run.mutate(() => leaveTeam()),
        },
      ],
    );
  }, [run]);

  const rowActions = useCallback(
    (member: TeamMember): SheetAction[] => {
      const allowed = memberActions(myRole, member, user?.id ?? null);
      const actions: SheetAction[] = [];
      if (allowed.has("change_role")) {
        actions.push({ label: "Change role", icon: Users, onPress: () => setRoleFor(member) });
      }
      if (allowed.has("resend_confirmation")) {
        actions.push({
          label: "Resend confirmation email",
          icon: Send,
          onPress: () => run.mutate(() => resendMemberConfirmation(member.id)),
        });
      }
      if (allowed.has("remove")) {
        actions.push({
          label: "Remove from team",
          icon: UserX,
          destructive: true,
          onPress: () => confirmRemove(member),
        });
      }
      return actions;
    },
    [myRole, user?.id, run, confirmRemove],
  );

  if (query.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Team" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (query.error) {
    return (
      <>
        <Stack.Screen options={{ title: "Team" }} />
        <ErrorState
          title="Could not load your team"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  /*
   * No team at all is a normal starting state, not an error. Creating one is
   * deliberately absent: it happens once, during setup, and belongs with the
   * rest of the wizard rather than behind a roster screen.
   */
  if (!data?.team) {
    return (
      <>
        <Stack.Screen options={{ title: "Team" }} />
        <EmptyState
          icon={Users}
          title="No team yet"
          body="Set your workspace up on the web app once, and the roster appears here."
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: data.team.name?.trim() || "Team" }} />

      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs }}>
          <Text variant="caption" tone="muted">
            {seatSummary(used, limit)}
          </Text>
          {failure ? (
            <Badge label={failure} tone="danger" icon={TriangleAlert} variant="soft" />
          ) : null}
        </View>

        <SectionHeader title={`People (${members.length})`} />
        <View style={{ paddingHorizontal: spacing.lg }}>
          {members.length === 0 ? (
            <EmptyState icon={Users} title="Just you so far" body={rosterEmptyBody(plan)} />
          ) : (
            <ListGroup>
              {members.map((member, index) => {
                const available = rowActions(member);
                return (
                  <View key={member.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      title={memberName(member)}
                      subtitle={memberSubtitle(member)}
                      right={
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                        >
                          {/*
                            An unconfirmed address is the reason a new hire
                            "cannot log in", and it is invisible everywhere else
                            in the app. `null` means the server could not tell,
                            which is not the same as unconfirmed.
                          */}
                          {member.emailConfirmed === false ? (
                            <Badge label="Unconfirmed" tone="warning" variant="soft" />
                          ) : null}
                          <Badge
                            label={roleLabelForTier(member.role, plan)}
                            tone={normaliseRole(member.role) === "owner" ? "primary" : "neutral"}
                            variant="outline"
                          />
                          <Avatar
                            name={memberName(member)}
                            uri={member.profile?.avatar_url}
                            size="sm"
                          />
                        </View>
                      }
                      // No chevron, and no press target, when there is nothing
                      // behind the row. A row that opens an empty sheet is
                      // worse than a row that does not respond.
                      onPress={available.length > 0 ? () => setActionsFor(member) : undefined}
                    />
                  </View>
                );
              })}
            </ListGroup>
          )}
        </View>

        {invites.length > 0 ? (
          <>
            <SectionHeader title={`Invited (${invites.length})`} />
            <View style={{ paddingHorizontal: spacing.lg }}>
              <ListGroup>
                {invites.map((invite, index) => (
                  <View key={invite.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <InviteRow
                      invite={invite}
                      plan={plan}
                      canManage={canManageUsers}
                      onResend={() => run.mutate(() => resendInvite(invite.id))}
                      onRevoke={() => run.mutate(() => revokeInvite(invite.id))}
                    />
                  </View>
                ))}
              </ListGroup>
            </View>
          </>
        ) : null}

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.sm }}>
          <Button
            label="Invite somebody"
            icon={UserPlus}
            fullWidth
            disabled={blocked !== null || run.isPending}
            onPress={() => {
              setInviteError(null);
              setInviteOpen(true);
            }}
          />
          {/*
            The reason, always, when the button is dead. This is the difference
            between a plan gate and a bug as far as anybody looking at it is
            concerned.
          */}
          {blocked ? (
            <Text variant="caption" tone="muted">
              {blocked}
            </Text>
          ) : null}
        </View>

        {/*
          Leaving is offered to everyone except the owner, who cannot leave: it
          is the rule that stops a workspace ending up with nobody who can pay
          for it, and the server enforces it too.
        */}
        {normaliseRole(myRole) !== "owner" ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl }}>
            <Button
              label="Leave this team"
              variant="destructive"
              icon={LogOut}
              fullWidth
              disabled={run.isPending}
              onPress={confirmLeave}
            />
          </View>
        ) : null}
      </Screen>

      <ActionSheet
        visible={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        title={actionsFor ? memberName(actionsFor) : undefined}
        actions={actionsFor ? rowActions(actionsFor) : []}
      />

      <RolePicker
        member={roleFor}
        plan={plan}
        onClose={() => setRoleFor(null)}
        onPick={(role) => {
          const member = roleFor;
          setRoleFor(null);
          if (member) run.mutate(() => updateMemberRole(member.id, role));
        }}
      />

      <Sheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite somebody"
        subtitle="They get an email with a link to join this workspace."
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Email address"
            value={inviteEmail}
            onChangeText={(next) => {
              setInviteEmail(next);
              if (inviteError) setInviteError(null);
            }}
            placeholder="name@company.com"
            error={inviteError ?? undefined}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={submitInvite}
          />

          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted">
              Role
            </Text>
            {/*
              Two roles here and not the full matrix, because `inviteMember`
              only accepts admin or member. Anything narrower is set from the
              roster after they join, which is also when a manager or restricted
              role can be scoped to the right jobs.
            */}
            <ListGroup>
              <ListRow
                title={roleLabelForTier("member", plan)}
                subtitle={roleDescriptionForTier("member", plan)}
                right={
                  inviteRole === "member" ? <Badge label="Chosen" tone="primary" /> : undefined
                }
                onPress={() => setInviteRole("member")}
              />
              <RowDivider />
              <ListRow
                title={roleLabelForTier("admin", plan)}
                subtitle={roleDescriptionForTier("admin", plan)}
                right={inviteRole === "admin" ? <Badge label="Chosen" tone="primary" /> : undefined}
                onPress={() => setInviteRole("admin")}
              />
            </ListGroup>
          </View>

          <Button label="Send invite" icon={Send} fullWidth onPress={submitInvite} />
        </View>
      </Sheet>
    </>
  );
}

/** One pending invitation, with the two things anybody does to one. */
function InviteRow({
  invite,
  plan,
  canManage,
  onResend,
  onRevoke,
}: {
  invite: TeamInvite;
  plan: "starter" | "pro" | "team";
  canManage: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const [open, setOpen] = useState(false);
  const expired = isInviteExpired(invite);

  return (
    <>
      <ListRow
        title={invite.email}
        subtitle={roleLabelForTier(invite.role, plan)}
        right={
          expired ? (
            <Badge label="Expired" tone="warning" variant="soft" />
          ) : (
            <Badge label="Invited" tone="neutral" variant="outline" />
          )
        }
        onPress={canManage ? () => setOpen(true) : undefined}
      />
      <ActionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={invite.email}
        actions={[
          { label: "Send the invite again", icon: Send, onPress: onResend },
          { label: "Cancel this invite", icon: UserX, destructive: true, onPress: onRevoke },
        ]}
      />
    </>
  );
}

/**
 * The role sheet.
 *
 * Offers only what the plan actually holds. `assignableRoles` is the same
 * function the web app and the API use, so a Pro workspace sees Admin and
 * Standard and no Manager row that would be refused on submit.
 */
function RolePicker({
  member,
  plan,
  onClose,
  onPick,
}: {
  member: TeamMember | null;
  plan: "starter" | "pro" | "team";
  onClose: () => void;
  onPick: (role: AssignableRole) => void;
}) {
  // `assignmentsEnforced` is true: the project-assignment RLS shipped in
  // 20260919000000_project_assignment_notifications.sql and the web app passes
  // the same value. Passing false here would silently hide Restricted on Team.
  const roles = assignableRoles(plan, { assignmentsEnforced: true });
  const current = member ? normaliseRole(member.role) : null;

  return (
    <Sheet
      visible={member !== null}
      onClose={onClose}
      title={member ? `Role for ${memberName(member)}` : undefined}
    >
      <ListGroup>
        {roles.map((role, index) => (
          <View key={role}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              title={roleLabelForTier(role, plan)}
              subtitle={roleDescriptionForTier(role, plan)}
              right={current === role ? <Badge label="Current" tone="primary" /> : undefined}
              onPress={() => onPick(role)}
            />
          </View>
        ))}
      </ListGroup>
    </Sheet>
  );
}
