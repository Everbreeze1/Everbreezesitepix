import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  choiceLabel,
  findIndustry,
  industryLabel,
  INDUSTRIES,
  PROJECT_VOLUMES,
  TEAM_SIZES,
  type Choice,
} from "@everlumen/shared";
import { can } from "@everlumen/shared/team-permissions";
import { getMyTeam } from "@/api/team";
import { saveCompanyProfile, type CompanyProfilePatch } from "@/api/workspace";
import { spacing } from "@/theme";
import { PenLine, Tag } from "@/ui/icons";
import {
  Button,
  Chip,
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
} from "@/ui";

/**
 * Workspace settings: who the company is.
 *
 * The last of the four account rows that opened a browser. What is behind it
 * is six answers, and every one of them changes something the field app itself
 * shows: the industry decides which document templates lead the library, the
 * trades decide which headings come next. Somebody who set up on a laptop and
 * then only ever works from a phone had no way to correct a wrong answer.
 *
 * Every edit is its own save, because `saveCompanyProfile` is a partial patch:
 * it means "change these fields", not "these are all the answers now". Sending
 * the whole profile per edit would let this screen quietly overwrite an answer
 * somebody gave on the web thirty seconds earlier.
 */

const QUERY_KEY = ["my-team"] as const;

type Editing =
  | { kind: "name"; value: string }
  | { kind: "service_area"; value: string }
  | { kind: "industry" }
  | { kind: "trades" }
  | { kind: "team_size" }
  | { kind: "project_volume" }
  | null;

export default function WorkspaceScreen() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getMyTeam });
  const team = query.data?.team as (Record<string, unknown> & { name?: string | null }) | null;

  /*
   * The team row comes back from `getMyTeam` untouched, so these are database
   * columns rather than a shaped type. Reading them through one helper keeps
   * the casts in one place instead of six.
   */
  const str = useCallback(
    (key: string): string | null => {
      const value = team?.[key];
      return typeof value === "string" && value.trim() ? value : null;
    },
    [team],
  );

  const trades = useMemo(() => {
    const value = team?.trades;
    return Array.isArray(value) ? (value.filter((t) => typeof t === "string") as string[]) : [];
  }, [team]);

  const industry = findIndustry(str("industry"));
  const canEdit = can(query.data?.myRole, "manage_users");

  const save = useMutation({
    mutationFn: (patch: CompanyProfilePatch) => saveCompanyProfile(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not save."),
  });

  const commit = useCallback(
    (patch: CompanyProfilePatch) => {
      setEditing(null);
      setFailure(null);
      save.mutate(patch);
    },
    [save],
  );

  const openText = useCallback((kind: "name" | "service_area", current: string | null) => {
    setDraft(current ?? "");
    setEditing({ kind, value: current ?? "" });
  }, []);

  if (query.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Workspace" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (query.error) {
    return (
      <>
        <Stack.Screen options={{ title: "Workspace" }} />
        <ErrorState
          title="Could not load your workspace"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  const row = (
    title: string,
    value: string | null,
    onPress: () => void,
    unanswered = "Not set",
  ) => (
    <ListRow
      title={title}
      // The value is the subtitle rather than the right-hand slot: an industry
      // hint or a service area is a phrase, and the right slot truncates it to
      // a word and a half on a 6 inch screen.
      subtitle={value ?? unanswered}
      onPress={canEdit ? onPress : undefined}
    />
  );

  return (
    <>
      <Stack.Screen options={{ title: "Workspace" }} />

      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        {failure ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          </View>
        ) : null}

        <SectionHeader title="Business profile" />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListGroup>
            {row("Company name", team?.name ?? null, () => openText("name", team?.name ?? null))}
            <RowDivider />
            {row("Industry", industry?.label ?? null, () => setEditing({ kind: "industry" }))}
            <RowDivider />
            {row(
              "Trades",
              trades.length ? trades.map((t) => industryLabel(t) ?? t).join(", ") : null,
              () => setEditing({ kind: "trades" }),
              "All of them",
            )}
            <RowDivider />
            {row("Team size", choiceLabel(TEAM_SIZES, str("team_size")), () =>
              setEditing({ kind: "team_size" }),
            )}
            <RowDivider />
            {row("Projects a month", choiceLabel(PROJECT_VOLUMES, str("project_volume")), () =>
              setEditing({ kind: "project_volume" }),
            )}
            <RowDivider />
            {row("Service area", str("service_area"), () =>
              openText("service_area", str("service_area")),
            )}
          </ListGroup>
          {!canEdit ? (
            <Text variant="caption" tone="muted" style={{ paddingTop: spacing.sm }}>
              Only an owner or admin can change these.
            </Text>
          ) : null}
        </View>

        <SectionHeader title="What the industry changes" />
        <View style={{ paddingHorizontal: spacing.lg }}>
          {/*
            Said out loud, because otherwise the industry answer looks like a
            marketing question somebody is being asked for our benefit. It is
            not: it reorders the document library on this device.
          */}
          <Text variant="caption" tone="muted">
            {industry
              ? `Document templates lead with ${industry.categories.slice(0, 2).join(" and ")} everywhere you pick one.`
              : "Set an industry and the document templates for your trade lead the library, everywhere you pick one."}
          </Text>
        </View>

        <SectionHeader title="Elsewhere" />
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ListGroup>
            <ListRow
              icon={Tag}
              title="Labels"
              subtitle="The shared set everyone tags projects with"
              onPress={() => router.push("/labels")}
            />
          </ListGroup>
        </View>
      </Screen>

      <TextSheet
        editing={editing}
        draft={draft}
        onDraft={setDraft}
        onClose={() => setEditing(null)}
        onSave={(kind, value) =>
          // Blank clears rather than saves an empty string, which is what `null`
          // means to the op and what the web wizard does with an emptied box.
          commit(kind === "name" ? { companyName: value } : { service_area: value || null })
        }
      />

      <ChoiceSheet
        visible={editing?.kind === "industry"}
        title="Industry"
        subtitle="Decides which document templates lead the library."
        options={INDUSTRIES.map((i) => ({ id: i.id, label: i.label, hint: i.hint }))}
        current={str("industry")}
        onClose={() => setEditing(null)}
        onPick={(id) =>
          /*
           * Changing industry clears the trades. They are categories *of* the
           * old industry, so keeping them would leave an electrical contractor
           * tagged with roofing trades and no obvious way to notice.
           */
          commit({ industry: id, trades: [] })
        }
      />

      <ChoiceSheet
        visible={editing?.kind === "team_size"}
        title="Team size"
        options={TEAM_SIZES}
        current={str("team_size")}
        onClose={() => setEditing(null)}
        onPick={(id) => commit({ team_size: id })}
      />

      <ChoiceSheet
        visible={editing?.kind === "project_volume"}
        title="Projects a month"
        options={PROJECT_VOLUMES}
        current={str("project_volume")}
        onClose={() => setEditing(null)}
        onPick={(id) => commit({ project_volume: id })}
      />

      <TradesSheet
        visible={editing?.kind === "trades"}
        current={trades}
        onClose={() => setEditing(null)}
        onSave={(next) => commit({ trades: next })}
      />
    </>
  );
}

/** The one-line answers: company name and service area. */
function TextSheet({
  editing,
  draft,
  onDraft,
  onClose,
  onSave,
}: {
  editing: Editing;
  draft: string;
  onDraft: (next: string) => void;
  onClose: () => void;
  onSave: (kind: "name" | "service_area", value: string) => void;
}) {
  const kind = editing?.kind === "name" || editing?.kind === "service_area" ? editing.kind : null;

  return (
    <Sheet
      visible={kind !== null}
      onClose={onClose}
      title={kind === "name" ? "Company name" : "Service area"}
      subtitle={
        kind === "service_area" ? "Where you work. Shows on reports and public pages." : undefined
      }
    >
      <View style={{ gap: spacing.lg }}>
        <Field
          value={draft}
          onChangeText={onDraft}
          placeholder={kind === "name" ? "Riverside Electrical" : "Greater Manchester"}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => kind && onSave(kind, draft.trim())}
        />
        <Button
          label="Save"
          fullWidth
          // A company name is the one field here that cannot be blank: it is
          // what the team is called everywhere else in the product.
          disabled={kind === "name" && draft.trim().length === 0}
          onPress={() => kind && onSave(kind, draft.trim())}
        />
      </View>
    </Sheet>
  );
}

/** A single-answer picker. Choosing saves and closes: there is no second step. */
function ChoiceSheet({
  visible,
  title,
  subtitle,
  options,
  current,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: readonly Choice[];
  current: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <ListGroup>
        {options.map((option, index) => (
          <View key={option.id}>
            {index > 0 ? <RowDivider inset={false} /> : null}
            <ListRow
              title={option.label}
              subtitle={option.hint}
              value={current === option.id ? "Current" : undefined}
              onPress={() => onPick(option.id)}
            />
          </View>
        ))}
      </ListGroup>
    </Sheet>
  );
}

/**
 * Trades: a multi-select, so it saves on a button rather than on each tap.
 *
 * Empty is a real answer and means "all of them", which is why the sheet says
 * so rather than disabling the save. Somebody who does two trades and then
 * drops one should not have to guess whether clearing the list breaks anything.
 */
function TradesSheet({
  visible,
  current,
  onClose,
  onSave,
}: {
  visible: boolean;
  current: string[];
  onClose: () => void;
  onSave: (next: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(current);

  // Re-seed each time it opens, so a cancelled edit does not persist into the
  // next one.
  const [seenFor, setSeenFor] = useState<string>("");
  const key = current.join(",");
  if (visible && seenFor !== key) {
    setSeenFor(key);
    setPicked(current);
  }

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Trades"
      subtitle="Pick every trade you do. Leave it empty for all of them."
    >
      <View style={{ gap: spacing.lg }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {INDUSTRIES.map((i) => (
            <Chip
              key={i.id}
              label={i.label}
              selected={picked.includes(i.id)}
              onPress={() => toggle(i.id)}
            />
          ))}
        </View>
        <Button label="Save" icon={PenLine} fullWidth onPress={() => onSave(picked)} />
      </View>
    </Sheet>
  );
}
