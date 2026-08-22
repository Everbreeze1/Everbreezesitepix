import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, KeyRound, Loader2, MailCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  deletePlatformUser,
  getPlatformUserDetail,
  runUserSupportAction,
  type UserSupportAction,
} from "@/lib/admin.functions";
import { formatBytes } from "@/hooks/use-storage-usage";
import { usePrompt } from "@/hooks/use-prompt";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{value}</p>
    </div>
  );
}

function statusClass(code: number): string {
  if (code >= 500) return "bg-red-500/10 text-red-600";
  if (code >= 400) return "bg-amber-500/10 text-amber-600";
  return "bg-emerald-500/10 text-emerald-600";
}

export function AdminUserDetailPage() {
  const { userId } = useParams({ from: "/_app/admin/users/$userId" });
  const qc = useQueryClient();
  const prompt = usePrompt();
  const [busy, setBusy] = useState(false);

  const { data: user, isPending } = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => getPlatformUserDetail({ data: { userId } }),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
  };

  /*
   * Every support action asks for a reason before it runs, and the reason is
   * written to the audit log beside the action. An audit row reading "suspended
   * user X" is only half an answer six weeks later.
   */
  const runAction = async (action: UserSupportAction, title: string, description: string) => {
    const reason = await prompt({
      title,
      description,
      label: "Reason (recorded in the audit log)",
      placeholder: "Ticket number, or what the customer asked for",
      confirmText: "Continue",
    });
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    try {
      const res = await runUserSupportAction({
        data: { userId, action, reason: reason.trim(), origin: window.location.origin },
      });
      toast.success(res.message);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "That action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!user?.email) return;
    const reason = await prompt({
      title: "Delete this account",
      description:
        "This cannot be undone. Their projects are NOT deleted - they stay in the database, attributed to a user who no longer exists.",
      label: "Reason (recorded in the audit log)",
      confirmText: "Continue",
    });
    if (!reason || reason.trim().length < 3) return;

    // Typed confirmation, then a final yes/no. The server checks the typed
    // email as well - this dialog is not the only caller.
    const typed = await prompt({
      title: "Type the email to confirm",
      description: `Type ${user.email} exactly to delete this account.`,
      label: "Email",
      confirmText: "Delete account",
    });
    if (!typed) return;

    setBusy(true);
    try {
      const res = await deletePlatformUser({
        data: { userId, reason: reason.trim(), confirmEmail: typed.trim() },
      });
      toast.success(
        res.orphanedProjects
          ? `Account deleted. ${res.orphanedProjects} project(s) are now unattributed.`
          : "Account deleted.",
      );
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete the account");
    } finally {
      setBusy(false);
    }
  };

  if (isPending || !user) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const suspended = !!user.auth?.bannedUntil && new Date(user.auth.bannedUntil) > new Date();

  return (
    <div className="space-y-4">
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All users
      </Link>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-foreground">
              {user.fullName ?? user.email ?? "Unnamed account"}
            </h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {user.isPlatformAdmin && (
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-bold uppercase text-primary">
                platform admin
              </span>
            )}
            {suspended && (
              <span className="rounded-full bg-red-500/10 px-2 py-1 text-[11px] font-bold uppercase text-red-600">
                suspended
              </span>
            )}
            {user.auth && !user.auth.emailConfirmedAt && (
              <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-bold uppercase text-amber-600">
                email unconfirmed
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Company" value={user.company ?? "-"} />
          <Field label="Job title" value={user.jobTitle ?? "-"} />
          <Field label="Signed up" value={new Date(user.createdAt).toLocaleDateString()} />
          <Field
            label="Last sign-in"
            value={
              user.auth?.lastSignInAt
                ? new Date(user.auth.lastSignInAt).toLocaleString()
                : "Never signed in"
            }
          />
          <Field label="Sign-in method" value={user.auth?.provider ?? "-"} />
          <Field
            label="Email confirmed"
            value={
              user.auth?.emailConfirmedAt
                ? new Date(user.auth.emailConfirmedAt).toLocaleDateString()
                : "No"
            }
          />
          <Field label="Projects" value={user.totals.projects} />
          <Field
            label="Storage"
            value={`${formatBytes(user.totals.storageBytes)} (${user.totals.photos} photos)`}
          />
        </div>

        {!user.auth && (
          <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600">
            Auth details could not be read for this account. The profile exists but the auth user
            may have been deleted.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Support actions</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Each one asks for a reason and is written to the audit log.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              runAction(
                "send_password_reset",
                "Send a password reset",
                `A reset link will be emailed to ${user.email}.`,
              )
            }
          >
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Send password reset
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !!user.auth?.emailConfirmedAt}
            onClick={() =>
              runAction(
                "resend_confirmation",
                "Resend the confirmation email",
                `A new confirmation link will be emailed to ${user.email}.`,
              )
            }
          >
            <MailCheck className="mr-1.5 h-3.5 w-3.5" /> Resend confirmation
          </Button>
          {suspended ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                runAction(
                  "reinstate",
                  "Reinstate this account",
                  "They will be able to sign in again immediately.",
                )
              }
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Reinstate
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                runAction(
                  "suspend",
                  "Suspend this account",
                  "They will be signed out and unable to sign in. Reversible from this page.",
                )
              }
            >
              <Ban className="mr-1.5 h-3.5 w-3.5" /> Suspend
            </Button>
          )}
          <Button size="sm" variant="destructive" disabled={busy} onClick={handleDelete}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete account
          </Button>
        </div>
      </div>

      {user.teams.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">Teams</p>
          <div className="mt-3 space-y-2">
            {user.teams.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <Link
                  to="/admin/teams/$teamId"
                  params={{ teamId: t.id }}
                  className="text-sm font-bold text-foreground hover:underline"
                >
                  {t.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {t.isOwner ? "owner" : t.role} · {t.plan} · {t.subscriptionStatus}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">
          Projects{" "}
          <span className="font-normal text-muted-foreground">({user.projects.length})</span>
        </p>
        {user.projects.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            This account has created no projects.
          </p>
        ) : (
          <div className="mt-3 max-h-[320px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Photos</th>
                  <th className="pb-2 pr-4">Storage</th>
                  <th className="pb-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {user.projects.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium text-foreground">
                      {p.name}
                      {p.deletedAt && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                          in trash
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{p.status}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{p.photoCount}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {formatBytes(p.storageBytes)}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Recent API activity</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The last 50 requests this account made. Use the request id when correlating with logs.
        </p>
        {user.recentActivity.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No recorded activity.</p>
        ) : (
          <div className="mt-3 max-h-[360px] space-y-1 overflow-y-auto">
            {user.recentActivity.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
              >
                <span className={`rounded-full px-2 py-0.5 font-bold ${statusClass(a.httpStatus)}`}>
                  {a.httpStatus}
                </span>
                <span className="font-bold text-foreground">{a.op ?? a.route}</span>
                {a.errorCode && <span className="text-red-600">{a.errorCode}</span>}
                <span className="ml-auto text-muted-foreground">
                  {a.durationMs !== null ? `${a.durationMs} ms · ` : ""}
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
