import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProjectCrew,
  listCrewCandidates,
  setProjectCrew,
  type CrewCandidate,
} from "@/api/project-assignees";
import {
  assignRefusal,
  changeSummary,
  crewName,
  crewSummary,
  hasChanges,
  sortedRoster,
  toggled,
} from "@/api/project-assignees-view";
import { radius, spacing, useTheme } from "@/theme";
import { Check, HardHat, Users } from "./icons";
import { Avatar, AvatarStack } from "./Avatar";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { EmptyState, SkeletonList } from "./State";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

/**
 * Who is on this job, on the project screen.
 *
 * `project_assignments` has existed all along, the web has a dialog for it, and
 * `project_assigned` is a notification type the phone already knew how to route
 * - it simply had no way to raise one. Which is backwards for a feature about
 * who is standing on a site: the person who knows the answer is the one holding
 * the phone.
 *
 * The row is shown even to somebody who cannot change the crew. Reading it is
 * useful on its own, and hiding it from a Restricted member would leave them
 * thinking the job is unstaffed rather than knowing they may not staff it.
 */
export function ProjectCrew({ projectId }: { projectId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const queryKey = useMemo(() => ["project-crew", projectId], [projectId]);

  const crewQuery = useQuery({
    queryKey,
    queryFn: () => getProjectCrew(projectId),
    enabled: Boolean(projectId),
  });

  const peopleQuery = useQuery({
    queryKey: ["crew-candidates"],
    queryFn: listCrewCandidates,
    // Only when the sheet is open: the row itself renders from the roster it
    // already has cached on most screens, and a solo account has no roster to
    // fetch at all.
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const assigned = crewQuery.data?.assigned ?? [];
  const canAssign = crewQuery.data?.canAssign ?? false;
  const people = peopleQuery.data ?? [];

  // Re-seeded each time the sheet opens, so an abandoned edit does not persist
  // into the next one and quietly save changes nobody remembers making.
  useEffect(() => {
    if (open) setSelected(assigned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    mutationFn: () => setProjectCrew(projectId, selected),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, { assigned: selected, canAssign });
      setOpen(false);
    },
    onError: (error: unknown) =>
      Alert.alert(
        "Could not save the crew",
        error instanceof Error ? error.message : "Please try again.",
      ),
  });

  const roster = useMemo(() => sortedRoster(people, selected), [people, selected]);
  const summary = crewSummary(people.length ? people : [], assigned);
  const pending = changeSummary(people, assigned, selected);
  const refusal = assignRefusal(canAssign);

  if (crewQuery.isLoading || crewQuery.error) {
    // Silent on failure. The crew is context rather than the point of the
    // screen, and an error card here would sit above the photographs somebody
    // opened the project to see.
    return null;
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={canAssign ? "Change who is on this job" : "Who is on this job"}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          paddingVertical: spacing.sm,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon icon={HardHat} size="md" tone="muted" />
        {assigned.length > 0 ? (
          <AvatarStack
            people={assigned.map((id) => {
              const person = people.find((p) => p.userId === id);
              return { name: person ? crewName(person) : null, uri: person?.avatarUrl };
            })}
            max={3}
            size="sm"
          />
        ) : null}
        <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
          {/*
            Names once the roster is loaded, a count before that. A count is a
            poor substitute, but "3 on this job" is honest and does not make the
            row jump as names arrive.
          */}
          {people.length > 0
            ? summary
            : assigned.length === 0
              ? "Nobody assigned"
              : `${assigned.length} on this job`}
        </Text>
        {canAssign ? (
          <Text variant="caption" tone="primary">
            Change
          </Text>
        ) : null}
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="On this job"
        subtitle={refusal ?? undefined}
        footer={
          canAssign ? (
            <View style={{ gap: spacing.sm }}>
              {pending ? (
                // Said before the save, not after. Assigning somebody sends a
                // push, and a foreman tidying a crew list should know how many
                // phones that lights up.
                <Text variant="caption" tone="muted">
                  {pending}
                </Text>
              ) : null}
              <Button
                label={save.isPending ? "Saving" : "Save crew"}
                fullWidth
                disabled={save.isPending || !hasChanges(assigned, selected)}
                onPress={() => save.mutate()}
              />
            </View>
          ) : undefined
        }
      >
        {peopleQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : peopleQuery.error ? (
          <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
            <Text variant="body" tone="muted">
              {peopleQuery.error instanceof Error
                ? peopleQuery.error.message
                : "Could not load your team."}
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => void peopleQuery.refetch()}
            />
          </View>
        ) : roster.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No teammates yet"
            body="Invite people to your team and you can put them on a job."
          />
        ) : (
          <ScrollView style={{ maxHeight: 400 }}>
            <View style={{ gap: spacing.xs }}>
              {roster.map((person) => (
                <CrewRow
                  key={person.userId}
                  person={person}
                  on={selected.includes(person.userId)}
                  disabled={!canAssign}
                  onToggle={() => setSelected((cur) => toggled(cur, person.userId))}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </Sheet>
    </>
  );
}

function CrewRow({
  person,
  on,
  disabled,
  onToggle,
}: {
  person: CrewCandidate;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const name = crewName(person);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={name}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: on ? theme.colors.primary : theme.colors.border,
        backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <Avatar name={name} uri={person.avatarUrl} size="sm" />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {person.role}
        </Text>
      </View>
      {on ? <Icon icon={Check} size="md" tone="primary" /> : null}
    </Pressable>
  );
}
