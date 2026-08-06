import { useState } from "react";
import { Copy, ExternalLink, Globe, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { setShowcaseShare } from "@/lib/showcases.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showcaseId: string;
  title: string;
  shareToken: string;
  /** Non-null means sharing is currently OFF. */
  revokedAt: string | null;
  /** Reports the new revoked_at so the caller's list/builder stays in sync. */
  onChanged: (revokedAt: string | null) => void;
  /** Shown when the builder has edits that aren't saved yet. */
  hasUnsavedChanges?: boolean;
}

/**
 * Sharing a showcase, deliberately identical in shape to sharing a document
 * (see the share dialog in ProjectDocuments / ProjectPageEditorPage): a single
 * on/off switch, then the link. One pattern for "make this public and give me
 * the URL" everywhere in the product.
 */
export function ShowcaseShareDialog({
  open,
  onOpenChange,
  showcaseId,
  title,
  shareToken,
  revokedAt,
  onChanged,
  hasUnsavedChanges,
}: Props) {
  const [updating, setUpdating] = useState(false);
  const published = !revokedAt;
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/share/showcases/${shareToken}` : "";

  const toggle = async (enable: boolean) => {
    setUpdating(true);
    try {
      await setShowcaseShare({ data: { id: showcaseId, enable } });
      onChanged(enable ? null : new Date().toISOString());
      toast.success(enable ? "Portfolio published" : "Sharing turned off");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update sharing");
    } finally {
      setUpdating(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">Share “{title}”</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this portfolio — no SitePix account needed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">
                {published ? "Anyone with the link" : "Link sharing off"}
              </p>
              <p className="text-xs text-muted-foreground">
                {published
                  ? "Send it to prospects, post it anywhere"
                  : "Only your team can see this portfolio"}
              </p>
            </div>
          </div>
          {updating ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Switch checked={published} onCheckedChange={toggle} />
          )}
        </div>

        {published && (
          <>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={url}
                className="h-9 text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button size="sm" onClick={copy}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
              </Button>
            </div>
            {hasUnsavedChanges && (
              <p className="text-xs text-amber-600">
                You have unsaved changes — visitors still see the last saved version.
              </p>
            )}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in a new tab
            </a>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
