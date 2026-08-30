import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listProjects, type ProjectListItem } from "@/api/projects";
import {
  inviteSubcontractor,
  listSubcontractors,
  revokeSubcontractor,
  setSubcontractorProjects,
} from "@/api/subcontractors";
import {
  companyNameError,
  emailError,
  inviteBlockedReason,
  inviteSelectionError,
  projectNames,
  stateLabel,
  stateOf,
  subcontractorName,
  subcontractorSummary,
  type Subcontractor,
} from "@/api/subcontractor-view";
import { getMyTeam } from "@/api/team";
import { spacing } from "@/theme";
import { CircleCheck, FolderKanban, Send, TriangleAlert, UserPlus, UserX } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Outside firms, and the jobs they can see.
 *
 * **This is the highest-consequence screen in the app.** Every other list shows
 * a member of the team their own team's work. This one hands somebody outside
 * the workspace a login, and the difference between one job and all of them is
 * a single tick.
 *
 * Three consequences follow, and they are the whole design:
 *
 * 1. **Nothing is optimistic.** Everywhere else the app writes to the cache
 *    first so the phone feels immediate. Here an admin who sees "revoked" and
 *    walks away, on a write that actually failed, has left a stranger holding a
 *    key. Every state on this screen is one the server has confirmed.
 * 2. **Revoking names the jobs**, rather than counting them. "Revoke access to
 *    3 jobs" does not tell an admin whether the one they are worried about is
 *    among them.
 * 3. **The gate is stated, not just enforced.** A manager cannot do this, and
 *    neither can a Pro workspace, and both are told which it is.
 */
export default function CollaboratorsScreen() {
  const queryClient = useQueryClient();

  const [inviting, setInviting] = useState(false);
  const [scoping, setScoping] = useState<Subcontractor | null>(null);
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const subsQuery = useQuery({ queryKey: ["subcontractors"], queryFn: listSubcontractors });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const subs = useMemo(() => subsQuery.data ?? [], [subsQuery.data]);
  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => !project.archived),
    [projectsQuery.data],
  );

  const blocked = inviteBlockedReason(
    teamQuery.data?.myRole ?? null,
    teamQuery.data?.plan ?? "starter",
  );

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      // Refetched, never patched. See the note at the top of this file.
      void queryClient.invalidateQueries({ queryKey: ["subcontractors"] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not work."),
  });

  const openInvite = useCallback(() => {
    setEmail("");
    setCompany("");
    setChosen(new Set());
    setFormError(null);
    setInviting(true);
  }, []);

  const submitInvite = useCallback(() => {
    const bad =
      emailError(email, subs) ??
      companyNameError(company) ??
      inviteSelectionError(Array.from(chosen));
    if (bad) {
      setFormError(bad);
      return;
    }
    const payload = {
      email: email.trim().toLowerCase(),
      companyName: company.trim() || undefined,
      // Ordered by the project list rather than by tap order, so nothing
      // downstream inherits the sequence somebody happened to tap in.
      projectIds: projects.filter((p) => chosen.has(p.id)).map((p) => p.id),
    };
    setInviting(false);
    run.mutate(() => inviteSubcontractor(payload));
  }, [email, company, chosen, subs, projects, run]);

  const confirmRevoke = useCallback(
    (sub: Subcontractor) => {
      const names = projectNames(sub);
      Alert.alert(
        `Revoke ${subcontractorName(sub)}?`,
        names.length > 0
          ? // Named, not counted. An admin needs to know whether the job they
            // are worried about is in this list.
            `Their login stops working. They currently see:\n\n${names.map((n) => `  ${n}`).join("\n")}`
          : "Their login stops working. They currently see no jobs.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Revoke",
            style: "destructive",
            onPress: () => run.mutate(() => revokeSubcontractor(sub.id)),
          },
        ],
      );
    },
    [run],
  );

  const openScope = useCallback((sub: Subcontractor) => {
    setChosen(new Set(sub.projects.map((project) => project.id)));
    setFormError(null);
    setScoping(sub);
  }, []);

  const saveScope = useCallback(() => {
    const target = scoping;
    if (!target) return;
    /*
     * Empty is allowed here and is not allowed on invite. Taking the last job
     * away is how a firm is parked between phases of work without revoking
     * them, which is a thing admins actually do.
     */
    const ids = projects.filter((p) => chosen.has(p.id)).map((p) => p.id);
    setScoping(null);
    run.mutate(() => setSubcontractorProjects(target.id, ids));
  }, [scoping, chosen, projects, run]);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (formError) setFormError(null);
      return next;
    });

  return (
    <>
      <Stack.Screen options={{ title: "Collaborators" }} />

      <Screen
        scroll
        padded={false}
        refreshing={subsQuery.isRefetching}
        onRefresh={() => void subsQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
          <Text variant="caption" tone="muted">
            An outside firm gets a login that sees only the jobs you tick, and nothing else in the
            workspace.
          </Text>
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
        </View>

        {subsQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : subsQuery.error ? (
          <ErrorState
            title="Could not load collaborators"
            message={subsQuery.error instanceof Error ? subsQuery.error.message : undefined}
            onRetry={() => void subsQuery.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {subs.length === 0 ? (
              <EmptyState
                icon={UserPlus}
                title="No outside firms yet"
                body="Give a subcontractor a login scoped to the jobs they are actually on. They see those and nothing else."
                action={
                  blocked === null
                    ? { label: "Invite a firm", onPress: openInvite, icon: UserPlus }
                    : undefined
                }
              />
            ) : (
              subs.map((sub) => {
                const state = stateOf(sub);
                return (
                  <Card key={sub.id}>
                    <View style={{ gap: spacing.md }}>
                      <View
                        style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
                      >
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text variant="bodyStrong" numberOfLines={2}>
                            {subcontractorName(sub)}
                          </Text>
                          <Text variant="caption" tone="muted" numberOfLines={2}>
                            {subcontractorSummary(sub)}
                          </Text>
                        </View>
                        <Badge
                          label={stateLabel(state)}
                          tone={
                            state === "active"
                              ? "success"
                              : state === "expired"
                                ? "warning"
                                : "neutral"
                          }
                          variant={state === "active" ? "soft" : "outline"}
                        />
                      </View>

                      {sub.projects.length > 0 ? (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                          {projectNames(sub).map((name) => (
                            <Badge key={name} label={name} tone="neutral" variant="outline" />
                          ))}
                        </View>
                      ) : null}

                      {blocked === null ? (
                        <View style={{ flexDirection: "row", gap: spacing.sm }}>
                          <Button
                            label="Which jobs"
                            icon={FolderKanban}
                            size="sm"
                            variant="secondary"
                            onPress={() => openScope(sub)}
                          />
                          <Button
                            label="Revoke"
                            icon={UserX}
                            size="sm"
                            variant="destructive"
                            onPress={() => confirmRevoke(sub)}
                          />
                        </View>
                      ) : null}
                    </View>
                  </Card>
                );
              })
            )}

            {blocked === null && subs.length > 0 ? (
              <Button
                label="Invite a firm"
                icon={UserPlus}
                variant="secondary"
                fullWidth
                disabled={run.isPending}
                onPress={openInvite}
              />
            ) : null}

            {/*
              The reason, always. On this screen the explanation is the point:
              subcontractor access is deliberately narrower than "manage the
              team", and a manager who is refused should know it is not a bug.
            */}
            {blocked ? (
              <Badge label={blocked} tone="neutral" variant="soft" icon={TriangleAlert} />
            ) : null}
          </View>
        )}
      </Screen>

      <Sheet
        visible={inviting}
        onClose={() => setInviting(false)}
        title="Invite a firm"
        subtitle="They get an email with a link, and see only the jobs you tick."
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Email address"
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              if (formError) setFormError(null);
            }}
            placeholder="office@sparks.co.uk"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Field
            label="Company"
            value={company}
            onChangeText={setCompany}
            placeholder="Sparks Electrical"
            hint="Optional. Shown instead of the address."
            autoCapitalize="words"
          />

          <ProjectPicker projects={projects} chosen={chosen} onToggle={toggle} />

          {formError ? (
            <Text variant="caption" tone="destructive">
              {formError}
            </Text>
          ) : null}

          <Button label="Send invite" icon={Send} fullWidth onPress={submitInvite} />
        </View>
      </Sheet>

      <Sheet
        visible={scoping !== null}
        onClose={() => setScoping(null)}
        title={scoping ? `Jobs for ${subcontractorName(scoping)}` : undefined}
        subtitle={`${chosen.size} chosen`}
        footer={<Button label="Save" fullWidth onPress={saveScope} />}
      >
        <View style={{ gap: spacing.md }}>
          {chosen.size === 0 ? (
            <Text variant="caption" tone="muted">
              With no jobs ticked they keep their login but see nothing. That is how you park a firm
              between phases without revoking them.
            </Text>
          ) : null}
          <ProjectPicker projects={projects} chosen={chosen} onToggle={toggle} />
        </View>
      </Sheet>
    </>
  );
}

/** The tick list of jobs, shared by inviting and re-scoping. */
function ProjectPicker({
  projects,
  chosen,
  onToggle,
}: {
  projects: ProjectListItem[];
  chosen: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  if (projects.length === 0) {
    return <EmptyState icon={FolderKanban} title="No jobs to share yet" />;
  }
  return (
    <ListGroup>
      {projects.map((project, index) => {
        const on = chosen.has(project.id);
        return (
          <View key={project.id}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              icon={on ? CircleCheck : FolderKanban}
              iconTone={on ? "success" : "muted"}
              title={project.name}
              subtitle={project.client_name ?? project.city ?? undefined}
              right={on ? <Badge label="Shared" tone="success" /> : undefined}
              onPress={() => onToggle(project.id)}
            />
          </View>
        );
      })}
    </ListGroup>
  );
}
