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
  listPlatformUsers,
  sendAdminNotification,
  type PlatformUser,
} from "@/lib/admin.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

function ComposeCard({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [audience, setAudience] = useState<"all" | "user">("all");
  const [userQuery, setUserQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);
  const [sending, setSending] = useState(false);

  const debouncedQuery = useDebouncedValue(userQuery, 300);
  const { data: userResults } = useQuery({
    queryKey: ["admin", "users", "picker", debouncedQuery],
    queryFn: () => listPlatformUsers({ data: { search: debouncedQuery, limit: 8 } }),
    enabled: audience === "user" && debouncedQuery.trim().length > 1 && !selectedUser,
  });

  const canSend =
    title.trim().length > 0 && (audience === "all" || (audience === "user" && !!selectedUser));

  const send = async () => {
    setSending(true);
    try {
      const target =
        audience === "all" ? { type: "all" as const } : { type: "user" as const, userId: selectedUser!.id };
      const res = await sendAdminNotification({
        data: { title: title.trim(), body: body.trim() || null, linkPath: linkPath.trim() || null, target },
      });
      toast.success(`Sent to ${res.sentTo} user${res.sentTo === 1 ? "" : "s"}`);
      setTitle("");
      setBody("");
      setLinkPath("");
      setSelectedUser(null);
      setUserQuery("");
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
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={audience === "all" ? "default" : "outline"}
            onClick={() => setAudience("all")}
          >
            All users
          </Button>
          <Button
            size="sm"
            variant={audience === "user" ? "default" : "outline"}
            onClick={() => setAudience("user")}
          >
            Specific user
          </Button>
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
                        {u.fullName ?? "—"} <span className="text-muted-foreground">({u.email})</span>
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
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's new" />
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
          {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          Send
        </Button>
      </div>
    </div>
  );
}

export function AdminNotificationsPage() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["admin", "notifications"],
    queryFn: () => listAllNotifications({ data: {} }),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <ComposeCard onSent={() => qc.invalidateQueries({ queryKey: ["admin", "notifications"] })} />

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Recent notifications (all users)</p>
        {isPending || !data ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data.notifications.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto">
            {data.notifications.map((n) => (
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
        )}
      </div>
    </div>
  );
}
