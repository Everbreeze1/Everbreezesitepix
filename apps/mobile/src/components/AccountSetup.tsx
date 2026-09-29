import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMPANY_GOALS,
  HEARD_FROM,
  INDUSTRIES,
  PROJECT_VOLUMES,
  TEAM_SIZES,
  findIndustry,
  recommendedCategories,
  type Choice,
} from "@everlumen/shared";
import { getMyTeam } from "@/api/team";
import { dismissSetupPrompt, getSetupPromptDismissed, saveCompanyProfile } from "@/api/workspace";
import {
  SETUP_STEPS,
  canAdvance,
  canEditCompanyProfile,
  profileFromTeam,
  seedDraft,
  setupAutoOpenKey,
  setupPayload,
  shouldPromptSetup,
  toggled,
  withIndustry,
  type SetupDraft,
} from "@/api/account-setup-view";
import { useAuth } from "@/lib/auth";
import { radius, spacing, useTheme } from "@/theme";
import { ArrowRight, Check, ChevronLeft, PartyPopper, Sparkles, X } from "@/ui/icons";
import { Badge, Button, Card, Chip, Field, Icon, IconButton, Sheet, Text } from "@/ui";

/**
 * "Finish setting up your account", on Home: the web dashboard's
 * `AccountSetupCard` and its wizard.
 *
 * The wizard opens itself the first time somebody lands on Home on this
 * device, and after that it is a card with a dismiss. Opening once is what
 * makes it a flow rather than a banner nobody reads; opening only once, and
 * never blocking, is what keeps the first visit honest. The dismissal is saved
 * on the profile through the same op the web calls, so it holds on every
 * device. The card draws nothing when the profile is answered, when the person
 * is a crew member (the profile is company-wide), or after "not now".
 */
export function AccountSetupCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  // The same key every other screen reads the roster under, so a save here
  // refreshes Workspace settings and the template order too.
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam, enabled: !!user });
  const dismissedQuery = useQuery({
    queryKey: ["setup-prompt-dismissed", user?.id],
    queryFn: () => getSetupPromptDismissed(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const team = (teamQuery.data?.team ?? null) as Record<string, unknown> | null;
  const profile = useMemo(() => profileFromTeam(team), [team]);
  const hasTeam = Boolean(team);
  const companyName = typeof team?.name === "string" ? team.name : null;
  const prompt = shouldPromptSetup({
    loading: teamQuery.isLoading || dismissedQuery.isLoading || !!teamQuery.error,
    profile,
    canEdit: canEditCompanyProfile(hasTeam, teamQuery.data?.myRole),
    dismissed: dismissedQuery.data ?? false,
  });

  useEffect(() => {
    if (!user?.id || !prompt) return;
    let cancelled = false;
    void (async () => {
      const key = setupAutoOpenKey(user.id);
      try {
        if (await AsyncStorage.getItem(key)) return;
        // Written before opening, not after closing: a wizard abandoned once
        // must not come back on every visit.
        await AsyncStorage.setItem(key, "1");
      } catch {
        // Storage unavailable: do not auto-open. The card is still there.
        return;
      }
      if (!cancelled) setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, prompt]);

  const dismiss = useMutation({
    mutationFn: dismissSetupPrompt,
    onSuccess: () => queryClient.setQueryData(["setup-prompt-dismissed", user?.id], true),
  });

  // The wizard outlives the card: saving the last step completes the profile
  // and hides the card, and the "you are set up" step must still render.
  if (!prompt && !open) return null;

  return (
    <>
      {prompt ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Card
            style={{
              borderColor: theme.colors.primary,
              gap: spacing.md,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.colors.accent,
                }}
              >
                <Icon icon={Sparkles} size="md" tone="primary" />
              </View>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="bodyStrong">
                  Tell us your trade and we will sort your templates for it
                </Text>
                <Text variant="caption" tone="muted">
                  Two minutes. Your industry decides which documents lead the library.
                </Text>
              </View>
              <IconButton
                icon={X}
                accessibilityLabel="Dismiss setup reminder"
                surface={false}
                tone="muted"
                size="sm"
                disabled={dismiss.isPending}
                onPress={() => dismiss.mutate()}
              />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Button label="Set up account" iconRight={ArrowRight} onPress={() => setOpen(true)} />
            </View>
          </Card>
        </View>
      ) : null}

      <AccountSetupWizard
        visible={open}
        onClose={() => setOpen(false)}
        seed={seedDraft(profile, companyName)}
        hasTeam={hasTeam}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["my-team"] })}
      />
    </>
  );
}

/**
 * The four steps, in a sheet. Every step after the first can be skipped with
 * "Finish later", which still saves what was answered: the industry is the
 * answer the templates turn on, and losing it to a closed sheet would mean
 * asking again tomorrow.
 */
export function AccountSetupWizard({
  visible,
  onClose,
  seed,
  hasTeam,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  seed: SetupDraft;
  hasTeam: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(seed);
  const [failure, setFailure] = useState<string | null>(null);

  // Re-seed on open, not on mount, so a second visit shows what is stored now.
  useEffect(() => {
    if (!visible) return;
    setDraft(seed);
    setStep(0);
    setFailure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const current = SETUP_STEPS[step];
  const set = <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = useMutation({
    mutationFn: async (andClose: boolean) => {
      await saveCompanyProfile(setupPayload(draft));
      await onSaved();
      return andClose;
    },
    onSuccess: (andClose) => {
      if (andClose) onClose();
      else setStep(SETUP_STEPS.length - 1);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not save your details"),
  });

  const recommended = useMemo(
    () => recommendedCategories(draft.industry, draft.trades),
    [draft.industry, draft.trades],
  );

  const advance = canAdvance(current.id, draft, hasTeam);
  const lastQuestion = step === SETUP_STEPS.length - 2;

  const footer =
    current.id === "done" ? (
      <Button label="Start using it" fullWidth onPress={onClose} />
    ) : (
      <View style={{ gap: spacing.sm }}>
        {failure ? (
          <Text variant="caption" tone="destructive">
            {failure}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {step > 0 ? (
            <IconButton
              icon={ChevronLeft}
              accessibilityLabel="Back"
              disabled={save.isPending}
              onPress={() => setStep((s) => s - 1)}
            />
          ) : null}
          <View style={{ flex: 1 }} />
          {step > 0 ? (
            <Button
              label="Finish later"
              variant="ghost"
              disabled={save.isPending}
              onPress={() => save.mutate(true)}
            />
          ) : null}
          {lastQuestion ? (
            <Button
              label="Save and finish"
              loading={save.isPending}
              disabled={!advance || save.isPending}
              onPress={() => save.mutate(false)}
            />
          ) : (
            <Button
              label="Continue"
              iconRight={ArrowRight}
              disabled={!advance}
              onPress={() => setStep((s) => s + 1)}
            />
          )}
        </View>
      </View>
    );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={current.title}
      subtitle={`Set up your account, ${step + 1} of ${SETUP_STEPS.length}${current.blurb ? `. ${current.blurb}` : ""}`}
      footer={footer}
      maxHeightRatio={0.92}
    >
      {current.id === "industry" ? (
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Company name"
            value={draft.companyName}
            onChangeText={(v) => set("companyName", v.slice(0, 80))}
            placeholder="Northwind Mechanical"
            autoCapitalize="words"
            hint={
              hasTeam
                ? undefined
                : "This names your workspace, and it is what prints on the documents you send clients."
            }
          />
          <View style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">Your trade</Text>
            {INDUSTRIES.map((ind) => (
              <OptionRow
                key={ind.id}
                label={ind.label}
                hint={ind.hint}
                selected={draft.industry === ind.id}
                onPress={() => setDraft((d) => withIndustry(d, ind.id))}
              />
            ))}
          </View>
          {draft.industry ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="bodyStrong">Anything else you also do?</Text>
              <Text variant="caption" tone="muted">
                Optional. We will put both trades near the top of your templates.
              </Text>
              <ChipWrap
                options={INDUSTRIES.filter((i) => i.id !== draft.industry && i.id !== "other")}
                isSelected={(id) => draft.trades.includes(id)}
                onPress={(id) => set("trades", toggled(draft.trades, id))}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {current.id === "size" ? (
        <View style={{ gap: spacing.lg }}>
          <SingleChoice
            title="Team size"
            options={TEAM_SIZES}
            value={draft.team_size}
            onChange={(v) => set("team_size", v)}
          />
          <SingleChoice
            title="Jobs you document in a typical month"
            options={PROJECT_VOLUMES}
            value={draft.project_volume}
            onChange={(v) => set("project_volume", v)}
          />
          <Field
            label="Where you work"
            value={draft.service_area}
            onChangeText={(v) => set("service_area", v.slice(0, 120))}
            placeholder="Greater Manchester, or within 50 miles of Denver"
          />
        </View>
      ) : null}

      {current.id === "goals" ? (
        <View style={{ gap: spacing.lg }}>
          <View style={{ gap: spacing.sm }}>
            {COMPANY_GOALS.map((g) => (
              <OptionRow
                key={g.id}
                label={g.label}
                selected={draft.goals.includes(g.id)}
                onPress={() => set("goals", toggled(draft.goals, g.id))}
              />
            ))}
          </View>
          <SingleChoice
            title="How did you find us?"
            options={HEARD_FROM}
            value={draft.heard_from}
            onChange={(v) => set("heard_from", v)}
          />
        </View>
      ) : null}

      {current.id === "done" ? (
        <View style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg }}>
          <Icon icon={PartyPopper} size="xxl" tone="primary" />
          <Text variant="heading" align="center">
            {draft.companyName.trim() || "Your company"} is set up
          </Text>
          <Text variant="body" tone="muted" align="center">
            {findIndustry(draft.industry)?.label ?? "Your"} templates now lead the library,
            everywhere you pick one.
          </Text>
          {recommended.length > 0 ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: spacing.xs,
              }}
            >
              {recommended.map((c) => (
                <Badge key={c} label={c} tone="primary" variant="soft" />
              ))}
            </View>
          ) : null}
          <Text variant="caption" tone="muted" align="center">
            Change any of this later in Account, under Workspace settings.
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}

/** A full-width choice with a check, for the lists where the hint matters. */
function OptionRow({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        minHeight: 48,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon icon={Check} size="md" tone="primary" /> : null}
    </Pressable>
  );
}

function ChipWrap({
  options,
  isSelected,
  onPress,
}: {
  options: readonly Choice[];
  isSelected: (id: string) => boolean;
  onPress: (id: string) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {options.map((o) => (
        <Chip
          key={o.id}
          label={o.hint ? `${o.label} (${o.hint})` : o.label}
          selected={isSelected(o.id)}
          onPress={() => onPress(o.id)}
        />
      ))}
    </View>
  );
}

/** Single-select chips. Tapping the chosen one clears it, as on the web. */
function SingleChoice({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: readonly Choice[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="bodyStrong">{title}</Text>
      <ChipWrap
        options={options}
        isSelected={(id) => value === id}
        onPress={(id) => onChange(value === id ? null : id)}
      />
    </View>
  );
}
