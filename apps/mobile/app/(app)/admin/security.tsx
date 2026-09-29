import { useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { relativeTime } from "@everlumen/shared";
import { listShareLinks, revokeShareLinks, type AdminShareLink } from "@/api/admin";
import { SHARE_KIND_LABELS, SHARE_KINDS, type AdminShareKind } from "@/api/admin-view";
import { webAppLink } from "@/lib/api";
import {
  AdminGate,
  CapabilityNotice,
  useAdminCan,
  useReasonPrompt,
} from "@/components/admin/AdminKit";
import { spacing } from "@/theme";
import { CircleCheck, ExternalLink, ShieldCheck } from "@/ui/icons";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Security: every public share link on the platform, and revoking them.
 *
 * The web page's list with its kind filter; tap rows to select them, then
 * revoke with a reason. Superadmin only on the server, and said so here.
 */
export default function AdminSecurityScreen() {
  return (
    <AdminGate title="Security">
      <ShareLinks />
    </AdminGate>
  );
}

const key = (link: AdminShareLink) => `${link.kind}:${link.id}`;

function ShareLinks() {
  const queryClient = useQueryClient();
  const { denyReason } = useAdminCan();
  const denied = denyReason("owner");
  const [kind, setKind] = useState<AdminShareKind | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "share-links", kind],
    queryFn: () => listShareLinks(kind === "all" ? undefined : kind),
  });
  const links = useMemo(() => query.data?.links ?? [], [query.data]);
  const live = links.filter((link) => !link.revokedAt);

  const { ask, sheet } = useReasonPrompt((error) => {
    if (!error) {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["admin", "share-links"] });
    }
  });

  const toggle = (link: AdminShareLink) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key(link))) next.delete(key(link));
      else next.add(key(link));
      return next;
    });

  const revoke = () => {
    const chosen = live.filter((link) => selected.has(key(link)));
    if (chosen.length === 0) return;
    ask({
      title: `Revoke ${chosen.length} link${chosen.length === 1 ? "" : "s"}?`,
      description: "Anyone holding these links will find nothing there. This cannot be undone.",
      confirmLabel: "Revoke",
      destructive: true,
      run: async (reason) => {
        const byKind = new Map<AdminShareKind, string[]>();
        for (const link of chosen)
          byKind.set(link.kind, [...(byKind.get(link.kind) ?? []), link.id]);
        let revoked = 0;
        for (const [k, ids] of byKind) revoked += await revokeShareLinks(k, ids, reason);
        setNotice(`${revoked} link${revoked === 1 ? "" : "s"} revoked.`);
      },
    });
  };

  return (
    <>
      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            <Chip label="All" selected={kind === "all"} onPress={() => setKind("all")} />
            {SHARE_KINDS.map((k) => (
              <Chip
                key={k}
                label={SHARE_KIND_LABELS[k]}
                count={query.data?.counts[k]}
                selected={kind === k}
                onPress={() => {
                  setKind(k);
                  setSelected(new Set());
                }}
              />
            ))}
          </View>
          {(query.data?.unavailable ?? []).length > 0 ? (
            <Text variant="caption" tone="muted">
              Not readable: {query.data!.unavailable.join(", ")}
            </Text>
          ) : null}
          {notice ? <Text variant="caption">{notice}</Text> : null}
          <Button
            label={
              selected.size > 0 ? `Revoke ${selected.size} selected` : "Tap links to select them"
            }
            variant="destructive"
            fullWidth
            disabled={selected.size === 0 || Boolean(denied)}
            onPress={revoke}
          />
          <CapabilityNotice reason={denied} />

          {query.isLoading ? (
            <SkeletonList rows={6} />
          ) : query.error ? (
            <ErrorState
              title="Could not load share links"
              message={query.error instanceof Error ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          ) : links.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No share links" />
          ) : (
            <ListGroup>
              {links.map((link, index) => {
                const url = webAppLink(link.publicPath);
                return (
                  <View key={key(link)}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      icon={selected.has(key(link)) ? CircleCheck : undefined}
                      title={link.title || "Untitled"}
                      subtitle={`${SHARE_KIND_LABELS[link.kind] ?? link.kind} · ${
                        link.createdAt ? relativeTime(link.createdAt) : "date unknown"
                      }`}
                      chevron={false}
                      disabled={Boolean(link.revokedAt)}
                      onPress={link.revokedAt ? undefined : () => toggle(link)}
                      value={link.revokedAt ? "Revoked" : undefined}
                      right={
                        !link.revokedAt && url ? (
                          <IconButton
                            icon={ExternalLink}
                            accessibilityLabel="Open the public page"
                            surface={false}
                            onPress={() => void WebBrowser.openBrowserAsync(url)}
                          />
                        ) : undefined
                      }
                    />
                  </View>
                );
              })}
            </ListGroup>
          )}
        </View>
      </Screen>
      {sheet}
    </>
  );
}
