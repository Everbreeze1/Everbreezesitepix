import { useState } from "react";
import { Alert, View } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  listAllNotifications,
  listTeamDirectory,
  listUserDirectory,
  sendAdminNotification,
  type NotificationTarget,
} from "@/api/admin";
import { notificationError } from "@/api/admin-view";
import { AdminGate, useSettled } from "@/components/admin/AdminKit";
import { spacing } from "@/theme";
import { Bell, Building2, Send, UserRound } from "@/ui/icons";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

type Audience = "all" | "team" | "user";

/**
 * Notifications: send an in-app notice, and see what has gone out.
 *
 * The web page's form, audience and all: everybody, one team, or one person,
 * found by search. Sending to everybody asks once more, because it reaches
 * every account on the platform.
 */
export default function AdminNotificationsScreen() {
  return (
    <AdminGate title="Notifications">
      <Notifications />
    </AdminGate>
  );
}

function Notifications() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null);
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const settled = useSettled(search.trim());

  const pickerQuery = useQuery({
    queryKey: ["admin", "notify-picker", audience, settled],
    queryFn: async () =>
      audience === "team"
        ? (await listTeamDirectory({ search: settled, limit: 8 })).teams.map((t) => ({
            id: t.id,
            name: t.name,
            detail: t.owner.email ?? t.plan,
          }))
        : (await listUserDirectory({ search: settled, limit: 8 })).users.map((u) => ({
            id: u.id,
            name: u.fullName || u.email || "Unnamed",
            detail: u.email ?? "",
          })),
    enabled: audience !== "all" && settled.length >= 2,
  });

  const listQuery = useInfiniteQuery({
    queryKey: ["admin", "notifications"],
    queryFn: ({ pageParam }) => listAllNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = listQuery.data?.pages.flatMap((page) => page.notifications) ?? [];

  const send = async () => {
    const bad = notificationError({
      title,
      audience,
      teamId: team?.id ?? null,
      userId: user?.id ?? null,
    });
    if (bad) {
      setError(bad);
      return;
    }
    const target: NotificationTarget =
      audience === "team"
        ? { type: "team", teamId: team!.id }
        : audience === "user"
          ? { type: "user", userId: user!.id }
          : { type: "all" };
    const go = async () => {
      setSending(true);
      setError(null);
      try {
        const count = await sendAdminNotification({
          title: title.trim(),
          body: body.trim() || null,
          linkPath: linkPath.trim() || null,
          target,
        });
        setSent(`Sent to ${count} ${count === 1 ? "person" : "people"}.`);
        setTitle("");
        setBody("");
        setLinkPath("");
        void queryClient.invalidateQueries({ queryKey: ["admin", "notifications"] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "It did not send.");
      } finally {
        setSending(false);
      }
    };
    if (audience === "all") {
      Alert.alert("Send to everybody?", "This reaches every account on the platform.", [
        { text: "Cancel", style: "cancel" },
        { text: "Send", onPress: () => void go() },
      ]);
      return;
    }
    await go();
  };

  const picked = audience === "team" ? team : audience === "user" ? user : null;

  return (
    <Screen
      scroll
      padded={false}
      refreshing={listQuery.isRefetching}
      onRefresh={() => void listQuery.refetch()}
      bottomInset={spacing.xxl}
    >
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {(
            [
              ["all", "Everybody"],
              ["team", "One team"],
              ["user", "One person"],
            ] as const
          ).map(([id, label]) => (
            <Chip
              key={id}
              label={label}
              selected={audience === id}
              onPress={() => {
                setAudience(id);
                setSearch("");
                setTeam(null);
                setUser(null);
              }}
            />
          ))}
        </View>

        {audience !== "all" ? (
          picked ? (
            <ListGroup>
              <ListRow
                icon={audience === "team" ? Building2 : UserRound}
                title={picked.name}
                value="Change"
                onPress={() => (audience === "team" ? setTeam(null) : setUser(null))}
              />
            </ListGroup>
          ) : (
            <>
              <Field
                value={search}
                onChangeText={setSearch}
                placeholder={audience === "team" ? "Search team name" : "Search name or email"}
                autoCapitalize="none"
              />
              {(pickerQuery.data ?? []).length > 0 ? (
                <ListGroup>
                  {(pickerQuery.data ?? []).map((option, index) => (
                    <View key={option.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={audience === "team" ? Building2 : UserRound}
                        title={option.name}
                        subtitle={option.detail}
                        onPress={() =>
                          audience === "team"
                            ? setTeam({ id: option.id, name: option.name })
                            : setUser({ id: option.id, name: option.name })
                        }
                      />
                    </View>
                  ))}
                </ListGroup>
              ) : null}
            </>
          )
        ) : null}

        <Field label="Title" value={title} onChangeText={setTitle} placeholder="What's new" />
        <Field
          label="Body"
          value={body}
          onChangeText={setBody}
          hint="Optional"
          multiline
          rows={3}
        />
        <Field
          label="Link path"
          value={linkPath}
          onChangeText={setLinkPath}
          placeholder="/showcases"
          hint="Optional. Where tapping it takes them."
          autoCapitalize="none"
        />
        {error ? (
          <Text variant="caption" tone="destructive">
            {error}
          </Text>
        ) : null}
        {sent ? <Text variant="caption">{sent}</Text> : null}
        <Button
          label="Send notification"
          icon={Send}
          fullWidth
          loading={sending}
          disabled={sending}
          onPress={() => void send()}
        />
      </View>

      <SectionHeader title="Recently sent" />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {listQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Bell} title="Nothing sent yet" />
        ) : (
          rows.map((row) => (
            <Card key={row.id}>
              <View style={{ gap: 2 }}>
                <Text variant="bodyStrong">{row.title}</Text>
                {row.body ? (
                  <Text variant="caption" numberOfLines={3}>
                    {row.body}
                  </Text>
                ) : null}
                <Text variant="caption" tone="muted">
                  {row.recipient?.name || row.recipient?.email || "Unknown"} ·{" "}
                  {relativeTime(row.createdAt)} · {row.readAt ? "read" : "unread"}
                </Text>
              </View>
            </Card>
          ))
        )}
        {listQuery.hasNextPage ? (
          <Button
            label={listQuery.isFetchingNextPage ? "Loading" : "Load older"}
            variant="secondary"
            fullWidth
            disabled={listQuery.isFetchingNextPage}
            onPress={() => void listQuery.fetchNextPage()}
          />
        ) : null}
      </View>
    </Screen>
  );
}
