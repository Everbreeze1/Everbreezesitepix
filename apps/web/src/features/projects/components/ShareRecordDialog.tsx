import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/sitepix/client";
import { friendlyError } from "@/lib/supabase-errors";

/**
 * Issue or disable the public link for a checklist or workflow.
 *
 * The token is minted by the database default when the row is created, so this
 * only ever flips `revoked_at` — there is no "generate" step that could leave a
 * shared record without a link, and no window where the same record has two.
 *
 * Writes through supabase directly rather than an RPC: it is one column on a row
 * the owner and their teammates already hold RLS on, and every other write on
 * these two panels goes the same way. A server round-trip would be a second code
 * path to the same column.
 */
export function ShareRecordDialog({
  open,
  onOpenChange,
  table,
  recordId,
  title,
  shareToken,
  revokedAt,
  sharePath,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: "project_checklists" | "project_workflows";
  recordId: string;
  title: string;
  shareToken: string | null;
  revokedAt: string | null;
  /** Public route prefix, e.g. `/share/checklists`. */
  sharePath: string;
  onChanged: (patch: { revoked_at: string | null }) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const live = !revokedAt;
  /*
   * `typeof window` guard, even though both call sites live under `_app` — which
   * renders a loader until auth resolves and therefore never server-renders its
   * children. This dialog is mounted unconditionally (with `open={false}`), so
   * its body runs on every render of the host page; a component that reads
   * `window.location` at render time is one relocation away from an SSR crash on
   * a page nobody would think to re-test.
   */
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = shareToken ? `${origin}${sharePath}/${shareToken}` : "";

  async function toggle(enable: boolean) {
    setUpdating(true);
    const patch = { revoked_at: enable ? null : new Date().toISOString() };
    const { error } = await supabase
      .from(table as any)
      .update(patch)
      .eq("id", recordId);
    setUpdating(false);
    if (error) {
      toast.error(friendlyError(error, "Couldn't change the share setting"));
      return;
    }
    onChanged(patch);
    toast.success(enable ? "Link is live" : "Link disabled");
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">Share “{title}”</DialogTitle>
          <DialogDescription>
            Anyone with the link can read this record and print it. They cannot change it, and they
            see nothing else on the project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/25 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{live ? "Link is live" : "Link disabled"}</p>
            <p className="text-xs text-muted-foreground">
              {live
                ? "Turn this off and the link stops working immediately."
                : "Turn it on to hand this record to a customer or inspector."}
            </p>
          </div>
          {updating ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={live}
              onCheckedChange={(v) => void toggle(v)}
              aria-label="Public link"
            />
          )}
        </div>

        {live && url && (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={url}
              className="h-9 text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button size="sm" onClick={() => void copy()}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
