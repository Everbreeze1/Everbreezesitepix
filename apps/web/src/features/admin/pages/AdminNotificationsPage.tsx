import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, X as XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  listAllNotifications,
  listPlatformTeams,
  listPlatformUsers,
  sendAdminNotification,
  type AdminNotificationRow,
  type PlatformTeam,
  type PlatformUser,
} from "@/lib/admin.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useConfirm } from "@/hooks/use-confirm";
import { AdminList } from "../components/AdminTable";
import { useAdminList } from "../hooks/use-admin-list";

type Audience = "all" | "team" | "user";

const AUDIENCE_LABELS: Record<Audience, string> = {
  all: "All users",
  team: "One team",
  user: "Specific user",
};

function ComposeCard({ onSent }: { onSent: () => void }) {
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [userQuery, setUserQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);
  const [teamQuery, setTeamQuery] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<PlatformTeam | null>(null);
  const [sending, setSending] = useState(false);

  const debouncedUserQuery = useDebouncedValue(userQuery, 300);
  const { data: userResults } = useQuery({
    queryKey: ["admin", "users", "picker", debouncedUserQuery],
    queryFn: () => listPlatformUsers({ data: { search: debouncedUserQuery, limit: 8 } }),
    enabled: audience === "user" && debouncedUserQuery.trim().length > 1 && !selectedUser,
  });

  /*
   * The team picker. `sendAdminNotification` has accepted a team target since it
   * was written - the discriminated union in its schema has three arms - but the
   * form only ever offered two, so "tell this one company something" meant
   * either messaging every customer or sending the same note to each member by
   * hand.
   */
  const debouncedTeamQuery = useDebouncedValue(teamQuery, 300);
  const { data: teamResults } = useQuery({
    queryKey: ["admin", "teams", "picker", debouncedTeamQuery],
    queryFn: () => listPlatformTeams({ data: { search: debouncedTeamQuery, limit: 8 } }),
    enabled: audience === "team" && debouncedTeamQuery.trim().length > 1 && !selectedTeam,
  });

  const canSend =
    title.trim().length > 0 &&
    (audience === "all" ||
      (audience === "user" && !!selectedUser) ||
      (audience === "team" && !!selectedTeam));

  const resetTargets = (next: Audience) => {
    setAudience(next);
    setSelectedUser(null);
    setSelectedTeam(null);
    setUserQuery("");
    setTeamQuery("");
  };

  const send = async () => {
    /*
     * A broadcast to everyone is not undoable and lands in every customer's
     * notification bell at once. It is also one mis-click away from the two
     * targeted options sitting beside it, so it confirms; the targeted sends do
     * not, because they are small, reversible in practice, and confirming them
     * would train the operator to dismiss the dialog that matters.
     */
    if (audience === "all") {
      const ok = await confirm({
        title: "Send to every user?",
        description: `"${title.trim()}" will be delivered to every account on the platform. This cannot be recalled.`,
        confirmText: "Send to everyone",
      });
      if (!ok) return;
    }

    setSending(true);
    try {
      const target =
        audience === "all"
          ? { type: "all" as const }
          : audience === "team"
            ? { type: "team" as const, teamId: selectedTeam!.id }
            : { type: "user" as const, userId: selectedUser!.id };
      const res = await sendAdminNotification({
        data: {
          title: title.trim(),
          body: body.trim() || null,
          linkPath: linkPath.trim() || null,
          target,
        },
      });
      toast.success(`Sent to ${res.sentTo} user${res.sentTo === 1 ? "" : "s"}`);
      setTitle("");
      setBody("");
      setLinkPath("");
      resetTargets(audience);
      onSent();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">Send announcement</p>
      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={audience === key ? "default" : "outline"}
              onClick={() => resetTargets(key)}
            >
              {AUDIENCE_LABELS[key]}
            </Button>
          ))}
        </div>

        {audience === "user" && (
          <div className="relative max-w-sm">
            {selectedUser ? (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>
                  {selectedUser.fullName ?? selectedUser.email}{" "}
                  <span className="text-muted-foreground">({selectedUser.email})</span>
                </span>
                <button type="button" onClick={() => setSelectedUser(null)}>
                  <XIcon className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search name or email…"
                  className="h-9"
                />
                {userResults && userResults.users.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-md">
                    {userResults.users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(u);
                          setUserQuery("");
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        {u.fullName ?? "-"}{" "}
                        <span className="text-muted-foreground">({u.email})</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {audience === "team" && (
          <div className="relative max-w-sm">
            {selectedTeam ? (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>
                  {selectedTeam.name}{" "}
                  <span className="text-muted-foreground">
                    ({selectedTeam.memberCount}{" "}
                    {selectedTeam.memberCount === 1 ? "member" : "members"})
                  </span>
                </span>
                <button type="button" onClick={() => setSelectedTeam(null)}>
                  <XIcon className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={teamQuery}
                  onChange={(e) => setTeamQuery(e.target.value)}
                  placeholder="Search team name…"
                  className="h-9"
                />
                {teamResults && teamResults.teams.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-md">
                    {teamResults.teams.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setSelectedTeam(t);
                          setTeamQuery("");
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        {t.name}{" "}
                        <span className="text-muted-foreground">
                          ({t.memberCount} {t.memberCount === 1 ? "member" : "members"})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div>
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's new"
          />
        </div>
        <div>
          <Label>Body (optional)</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        </div>
        <div>
          <Label>Link path (optional)</Label>
          <Input
            value={linkPath}
            onChange={(e) => setLinkPath(e.target.value)}
            placeholder="/showcases"
          />
        </div>

        <Button onClick={send} disabled={!canSend || sending}>
          {sending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-4 w-4" />
          )}
          Send
        </Button>
      </div>
    </div>
  );
}

export function AdminNotificationsPage() {
  const qc = useQueryClient();
  const list = useAdminList<
    { notifications: AdminNotificationRow[]; nextCursor: string | null },
    AdminNotificationRow
  >({
    queryKey: ["admin", "notifications"],
    fetchPage: (cursor) => listAllNotifications({ data: { cursor } }),
    rowsOf: (page) => page.notifications,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <ComposeCard onSent={() => qc.invalidateQueries({ queryKey: ["admin", "notifications"] })} />

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Recent notifications (all users)</p>
        <AdminList
          count={list.rows.length}
          isPending={list.isPending}
          isFetchingMore={list.isFetchingMore}
          hasMore={list.hasMore}
          onLoadMore={list.loadMore}
          error={list.error}
          emptyMessage="No notifications yet."
        >
          <div className="mt-4 space-y-2">
            {list.rows.map((n) => (
              <div key={n.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">{n.title}</p>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                    {n.type.replace(/_/g, " ")}
                  </span>
                </div>
                {n.body && <p className="mt-1 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  To {n.recipient?.name ?? n.recipient?.email ?? "unknown"} ·{" "}
                  {new Date(n.createdAt).toLocaleString()} · {n.readAt ? "read" : "unread"}
                </p>
              </div>
            ))}
          </div>
        </AdminList>
      </div>
    </div>
  );
}
