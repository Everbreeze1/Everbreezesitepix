import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { deleteMyAccount } from "@/api/account-deletion";
import {
  confirmationError,
  confirmationMatches,
  deletionBlockedReason,
  WHAT_IS_DELETED,
  WHAT_REMAINS,
} from "@/api/account-deletion-view";
import { getMyTeam } from "@/api/team";
import { useAuth } from "@/lib/auth";
import { usePush } from "@/push/use-push";
import { spacing } from "@/theme";
import { CircleCheck, TriangleAlert, UserX } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
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
 * Closing your account.
 *
 * **This screen exists because a store requires it.** Google Play has demanded
 * an in-app or web-reachable deletion route since 2024 and has rejected a
 * support email address as the only path. Before this there was none: the
 * staff console can delete a customer and explicitly refuses to delete the
 * caller's own account.
 *
 * Everything about it is deliberately slow. The confirmation is the typed email
 * address, not a checkbox, because a checkbox is not a decision for something
 * irreversible. Both halves are listed, what goes and what stays, because the
 * question somebody actually has is whether the photographs go with it.
 *
 * One case is refused and it is a product gap rather than a rule: an owner with
 * colleagues cannot be deleted, because ownership cannot be transferred
 * anywhere in this product and deleting them would orphan a workspace people
 * are still working in. The screen says exactly that.
 */
export default function CloseAccountScreen() {
  const { user, signOut } = useAuth();
  const push = usePush();

  const [typed, setTyped] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });

  const otherMembers = useMemo(() => {
    const members = teamQuery.data?.members ?? [];
    return members.filter((member) => member.user_id !== user?.id).length;
  }, [teamQuery.data, user?.id]);

  const blocked = deletionBlockedReason(teamQuery.data?.myRole ?? null, otherMembers);
  const matches = confirmationMatches(typed, user?.email ?? null);

  const close = useMutation({
    mutationFn: async () => {
      /*
       * Unregister this phone's push token first. After the delete the session
       * is gone and the RLS delete would be refused, leaving a device that keeps
       * receiving for an account that no longer exists.
       */
      await push.unregister();
      await deleteMyAccount(typed.trim());
    },
    onSuccess: () => setDone(true),
    onError: (error: unknown) =>
      setFormError(
        error instanceof Error ? error.message : "That did not work. Nothing was deleted.",
      ),
  });

  const submit = useCallback(() => {
    const bad = confirmationError(typed, user?.email ?? null);
    if (bad) {
      setFormError(bad);
      return;
    }
    setFormError(null);
    close.mutate();
  }, [typed, user?.email, close]);

  if (done) {
    return (
      <>
        <Stack.Screen options={{ title: "Account closed" }} />
        <Screen scroll>
          <View style={{ paddingTop: spacing.xxl, gap: spacing.lg, alignItems: "center" }}>
            <Badge label="Closed" tone="neutral" icon={CircleCheck} />
            <Text variant="title" align="center">
              Your account is closed
            </Text>
            <Text variant="body" tone="muted" align="center">
              Everything listed has been deleted. Signing you out now.
            </Text>
            <Button
              label="Sign out"
              variant="destructive"
              fullWidth
              onPress={() => {
                void (async () => {
                  // The account is gone, so this is clearing the local session
                  // rather than ending a live one. It cannot fail usefully.
                  await signOut().catch(() => {});
                  router.replace("/login");
                })();
              }}
            />
          </View>
        </Screen>
      </>
    );
  }

  if (teamQuery.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Close account" }} />
        <SkeletonList rows={4} />
      </>
    );
  }

  if (teamQuery.error) {
    return (
      <>
        <Stack.Screen options={{ title: "Close account" }} />
        {/*
          Refused rather than allowed on a failed read. Whether somebody owns a
          workspace decides whether deleting them orphans one, and guessing that
          in the permissive direction is not a guess worth making.
        */}
        <ErrorState
          title="Could not check your workspace"
          message="Closing an account depends on knowing whether you own a workspace, so nothing can be done until this loads."
          onRetry={() => void teamQuery.refetch()}
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Close account" }} />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Badge label="This cannot be undone" tone="danger" icon={TriangleAlert} variant="soft" />
          <Text variant="body">
            Closing your account deletes it and the work below. There is no way to get it back.
          </Text>
        </View>

        <SectionHeader title="What is deleted" />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListGroup>
            {WHAT_IS_DELETED.map((item, index) => (
              <View key={item}>
                {index > 0 ? <RowDivider inset={false} /> : null}
                <ListRow title={item} />
              </View>
            ))}
          </ListGroup>
        </View>

        <SectionHeader title="What stays" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <ListGroup>
            {WHAT_REMAINS.map((item, index) => (
              <View key={item}>
                {index > 0 ? <RowDivider inset={false} /> : null}
                <ListRow title={item} />
              </View>
            ))}
          </ListGroup>
          {/*
            The half people are surprised by. A teammate's photograph on a shared
            project is theirs, not yours, and saying so prevents both the wrong
            expectation and the support ticket that follows it.
          */}
          <Text variant="caption" tone="muted">
            Work your teammates made is theirs and is not yours to delete.
          </Text>
        </View>

        {blocked ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl }}>
            <Card>
              <View style={{ gap: spacing.sm }}>
                <Badge label="Not yet" tone="warning" icon={TriangleAlert} variant="soft" />
                <Text variant="body">{blocked}</Text>
                <Button
                  label="Contact support"
                  variant="secondary"
                  fullWidth
                  onPress={() =>
                    router.push({ pathname: "/report-issue", params: { from: "/close-account" } })
                  }
                />
              </View>
            </Card>
          </View>
        ) : (
          <>
            <SectionHeader title="Confirm" />
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
              <Field
                label={`Type ${user?.email ?? "your email address"}`}
                value={typed}
                onChangeText={(next) => {
                  setTyped(next);
                  if (formError) setFormError(null);
                }}
                placeholder={user?.email ?? "you@company.com"}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="off"
                error={formError ?? undefined}
              />

              <Button
                label={close.isPending ? "Closing" : "Close my account"}
                icon={UserX}
                variant="destructive"
                fullWidth
                // Enabled only on an exact match. The server checks the same
                // thing; this is so the button is never live before the person
                // has actually typed it.
                disabled={!matches || close.isPending}
                onPress={submit}
              />

              <Text variant="caption" tone="muted">
                Changed your mind? Go back. Nothing happens until you tap the button above.
              </Text>
            </View>
          </>
        )}
      </Screen>
    </>
  );
}
