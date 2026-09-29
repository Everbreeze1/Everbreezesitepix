import { useState } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { exportUsers, listUserDirectory } from "@/api/admin";
import { formatBytes, PLANS, USER_FILTERS, type Plan } from "@/api/admin-view";
import { openShareSheet } from "@/api/sharing";
import { AdminGate, useAdminCan, useSettled } from "@/components/admin/AdminKit";
import { CreateUserSheet } from "@/components/admin/CreateUserSheet";
import { spacing } from "@/theme";
import { Download, UserPlus, UserRound } from "@/ui/icons";
import {
  Badge,
  Button,
  Chip,
  ChipGroup,
  EmptyState,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SearchField,
  SkeletonList,
  Text,
} from "@/ui";

const PAGE = 30;

/**
 * Users: the web console's user directory.
 *
 * Search, the same status and plan filters, paging, create an account and
 * export the filtered list. Filtering and counting happen in SQL on the server
 * (`listUserDirectory`), so the phone passes the filters through.
 */
export default function AdminUsersScreen() {
  return (
    <AdminGate title="Users">
      <UsersDirectory />
    </AdminGate>
  );
}

function UsersDirectory() {
  const queryClient = useQueryClient();
  const { denyReason } = useAdminCan();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [plan, setPlan] = useState<Plan | "all">("all");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const settled = useSettled(search.trim());

  const filters = {
    search: settled || undefined,
    status: status === "all" ? undefined : status,
    plan: plan === "all" ? undefined : plan,
  };
  const query = useQuery({
    queryKey: ["admin", "users", filters, offset],
    queryFn: () => listUserDirectory({ ...filters, offset, limit: PAGE }),
    placeholderData: keepPreviousData,
  });
  const users = query.data?.users ?? [];
  const total = query.data?.total ?? 0;
  const createDenied = denyReason("owner");

  const doExport = async () => {
    try {
      const result = await exportUsers(filters);
      if (!result.csv) {
        setNotice("Nothing to export with these filters.");
        return;
      }
      await openShareSheet(result.csv, `Everlumen users (${result.rows})`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The export did not work.");
    }
  };

  const setFilter = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              <IconButton
                icon={Download}
                accessibilityLabel="Export the filtered list"
                surface={false}
                onPress={() => void doExport()}
              />
              {createDenied ? null : (
                <IconButton
                  icon={UserPlus}
                  accessibilityLabel="Create an account"
                  surface={false}
                  tone="primary"
                  onPress={() => setCreating(true)}
                />
              )}
            </View>
          ),
        }}
      />
      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingTop: spacing.lg, gap: spacing.sm }}>
          <SearchField
            value={search}
            onChangeText={(next) => setFilter(() => setSearch(next))}
            placeholder="Name, email or company"
          />
          <ChipGroup
            label="Account status"
            options={USER_FILTERS.map((f) => ({ id: f.id as string, label: f.label }))}
            value={status}
            onChange={(next) => setFilter(() => setStatus(next))}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.xs,
              paddingHorizontal: spacing.lg,
            }}
          >
            {(["all", ...PLANS] as const).map((option) => (
              <Chip
                key={option}
                label={option === "all" ? "Any plan" : option}
                selected={plan === option}
                onPress={() => setFilter(() => setPlan(option))}
              />
            ))}
          </View>
          <View style={{ paddingHorizontal: spacing.lg }}>
            <Text variant="caption" tone="muted">
              {query.isLoading ? "Loading" : `${total} account${total === 1 ? "" : "s"}`}
            </Text>
            {notice ? (
              <Text variant="caption" tone="destructive">
                {notice}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md }}>
          {query.isLoading ? (
            <SkeletonList rows={6} />
          ) : query.error ? (
            <ErrorState
              title="Could not load accounts"
              message={query.error instanceof Error ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          ) : users.length === 0 ? (
            <EmptyState icon={UserRound} title="No accounts match" />
          ) : (
            <ListGroup>
              {users.map((user, index) => (
                <View key={user.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    icon={UserRound}
                    title={user.fullName || user.email || "Unnamed account"}
                    subtitle={[
                      user.email,
                      user.team
                        ? `${user.team.name} (${user.team.plan}, ${user.team.role})`
                        : "No team",
                      `${user.projectCount} projects, ${formatBytes(user.storageBytes)}`,
                    ]
                      .filter(Boolean)
                      .join("\n")}
                    right={
                      user.suspended ? (
                        <Badge label="Suspended" tone="danger" />
                      ) : !user.emailConfirmed ? (
                        <Badge label="Unconfirmed" tone="warning" />
                      ) : user.adminRole ? (
                        <Badge label={user.adminRole} tone="primary" />
                      ) : undefined
                    }
                    onPress={() => router.push(`/admin/user/${user.id}`)}
                  />
                </View>
              ))}
            </ListGroup>
          )}

          {total > PAGE ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button
                label="Previous"
                variant="secondary"
                size="sm"
                disabled={offset === 0}
                onPress={() => setOffset((o) => Math.max(0, o - PAGE))}
              />
              <Text variant="caption" tone="muted" style={{ flex: 1, alignSelf: "center" }}>
                {offset + 1} to {Math.min(offset + PAGE, total)} of {total}
              </Text>
              <Button
                label="Next"
                variant="secondary"
                size="sm"
                disabled={offset + PAGE >= total}
                onPress={() => setOffset((o) => o + PAGE)}
              />
            </View>
          ) : null}
        </View>
      </Screen>

      <CreateUserSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })}
      />
    </>
  );
}
