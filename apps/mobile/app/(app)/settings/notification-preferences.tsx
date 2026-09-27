import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  prefEnabled,
  type NotificationPrefKey,
  type NotificationPrefs,
} from "@everlumen/shared";
import { getMyProfile, saveNotificationPrefs } from "@/api/profile";
import { useAuth } from "@/lib/auth";
import { spacing, useTheme } from "@/theme";
import { Mail } from "@/ui/icons";
import {
  ErrorState,
  Icon,
  ListGroup,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Which emails you get, the web Settings page's Notifications section.
 *
 * Stored on the profile (`notification_prefs`), which is what the email sender
 * reads, so a switch here governs real mail and matches the web's switch for
 * the same row. Every toggle saves on its own and reverts if the write fails:
 * a preferences screen with a Save button is one where somebody leaves thinking
 * a change took when it did not.
 *
 * The four rows are exactly the messages the product sends today, with the
 * web's words, and nothing else. Push has its own row under Account, because
 * whether a phone can receive push is a question about the phone.
 */
const ROWS: { key: NotificationPrefKey; label: string; desc: string }[] = [
  {
    key: "taskAssigned",
    label: "Tasks assigned to me",
    desc: "When a teammate hands you a job. This is the one crews rely on.",
  },
  {
    key: "taskComments",
    label: "Comments and mentions",
    desc: "Notes written on a task you are on, and messages that name you.",
  },
  {
    key: "taskUpdates",
    label: "Tasks I am copied in on",
    desc: "When work you are following is reassigned or closed.",
  },
  {
    key: "taskCompleted",
    label: "Work I assigned is done",
    desc: "When somebody finishes a job you handed to them.",
  },
];

export default function NotificationPreferencesScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState<NotificationPrefs>({});
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: () => getMyProfile(user!.id),
    enabled: Boolean(user?.id),
  });

  useEffect(() => {
    if (query.data) setPrefs(query.data.notification_prefs);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (next: NotificationPrefs) => saveNotificationPrefs(user!.id, next),
    onMutate: (next) => {
      const before = prefs;
      setPrefs(next);
      setError(null);
      return { before };
    },
    onError: (e, _next, context) => {
      if (context) setPrefs(context.before);
      setError(e instanceof Error ? e.message : "Could not save that change");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["my-profile"] }),
  });

  if (query.isLoading) return <SkeletonList rows={5} />;
  if (query.error) {
    return (
      <ErrorState
        title="Could not load your preferences"
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const emailOn = prefEnabled(prefs, "emailEnabled");
  const toggle = (patch: NotificationPrefs) => save.mutate({ ...prefs, ...patch });

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <ListGroup>
        <PrefRow
          icon
          label="Email notifications"
          desc="Delivered to your account inbox."
          value={emailOn}
          onChange={(value) => toggle({ emailEnabled: value })}
        />
      </ListGroup>

      <SectionHeader title="Email me about" />
      <ListGroup>
        {ROWS.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? <RowDivider /> : null}
            <PrefRow
              label={row.label}
              desc={row.desc}
              // Greyed out under the master switch rather than hidden: they are
              // still your settings, they just govern nothing while email is off.
              value={emailOn && prefEnabled(prefs, row.key)}
              disabled={!emailOn}
              onChange={(value) => toggle({ [row.key]: value } as NotificationPrefs)}
            />
          </View>
        ))}
      </ListGroup>

      {error ? (
        <Text variant="caption" tone="destructive">
          {error}
        </Text>
      ) : null}

      <Text variant="caption" tone="muted">
        {save.isPending ? "Saving" : "Saved automatically."} Turning email off does not affect the
        bell in the app, you will still see everything there. Invitations, password resets and other
        account email are always sent.
      </Text>
    </Screen>
  );
}

function PrefRow({
  icon = false,
  label,
  desc,
  value,
  disabled = false,
  onChange,
}: {
  icon?: boolean;
  label: string;
  desc: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {icon ? <Icon icon={Mail} size="md" tone="primary" /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" tone="muted">
          {desc}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.secondary, true: theme.colors.primary }}
        thumbColor={theme.colors.card}
        ios_backgroundColor={theme.colors.secondary}
      />
    </View>
  );
}
