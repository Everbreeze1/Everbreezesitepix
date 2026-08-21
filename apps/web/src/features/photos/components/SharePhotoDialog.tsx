import { useEffect, useState } from "react";
import { Copy, Globe, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { createPhotoShare, listPhotoShares, revokePhotoShare } from "@/lib/photo-shares.functions";

interface ShareRow {
  id: string;
  token: string;
  expires_at: string | null;
  allow_download: boolean;
  created_at: string;
  revoked_at: string | null;
}

/** The public route is spelled in exactly one place. */
export function shareUrl(token: string) {
  if (typeof window === "undefined") return `/share/photos/${token}`;
  return `${window.location.origin}/share/photos/${token}`;
}

/** A row a visitor could still open right now. */
function isLive(r: ShareRow): boolean {
  if (r.revoked_at) return false;
  return !r.expires_at || new Date(r.expires_at).getTime() > Date.now();
}

interface Props {
  open: boolean;
  onClose: () => void;
  photoId: string | null;
}

/**
 * Share one photo: a switch, then the link.
 *
 * Deliberately the same shape as sharing a document (ProjectDocuments /
 * ProjectPageEditorPage), a showcase (ShowcaseShareDialog) and a checklist or
 * workflow (ShareRecordDialog). One pattern for "make this public and give me
 * the URL" everywhere in the product.
 *
 * What this replaced was the odd one out: an expiry dropdown defaulting to
 * 7 days, a "Create & copy link" button that minted another token every time it
 * was pressed, and a list of every token the photo had ever been given. That is
 * the shape of the `photo_shares` table, not of a decision anybody wants to
 * make about a photo - and it meant a link handed to a customer went dead a
 * week later with nothing on screen having said so.
 *
 * The table still stores an expiry and a download flag; this writes the same
 * values reports do (no expiry, download allowed) and revokes to turn sharing
 * off, so nothing about the backend changed.
 */
export function SharePhotoDialog({ open, onClose, photoId }: Props) {
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  /*
   * Every live row, not just the one on show. A photo shared a few times
   * through the old dialog carries several working tokens, and "turn sharing
   * off" has to mean all of them or the link the customer already has keeps
   * working.
   */
  const [liveRows, setLiveRows] = useState<ShareRow[]>([]);

  const live = liveRows[0] ?? null;
  const url = live ? shareUrl(live.token) : "";

  useEffect(() => {
    /*
     * Clearing on the way out, not just loading on the way in. This component
     * outlives one opening, so a dialog closed on photo A and reopened on
     * photo B would otherwise render A's link for the frame before the effect
     * refetches - long enough to copy the wrong one.
     */
    if (!open || !photoId) {
      setLiveRows([]);
      setLoading(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const rows = (await listPhotoShares({ data: { photoId } })) as ShareRow[];
        if (!cancelled) setLiveRows((rows ?? []).filter(isLive));
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Could not load sharing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, photoId]);

  const toggle = async (enable: boolean) => {
    if (!photoId || updating) return;
    setUpdating(true);
    try {
      if (enable) {
        const row = (await createPhotoShare({
          data: { photoId, expiresInHours: 0, allowDownload: true },
        })) as ShareRow;
        setLiveRows([row]);
        toast.success("Link is live");
      } else {
        for (const r of liveRows) await revokePhotoShare({ data: { shareId: r.id } });
        setLiveRows([]);
        toast.success("Link sharing off");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change sharing");
    } finally {
      setUpdating(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy - select the link and copy it manually");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share photo</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this photo. They see nothing else on the project.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    {live ? "Anyone with the link" : "Link sharing off"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {live
                      ? "Turn this off and the link stops working immediately."
                      : "Only your team can see this photo."}
                  </p>
                </div>
              </div>
              {updating ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  checked={!!live}
                  onCheckedChange={(v) => void toggle(v)}
                  aria-label="Public link"
                />
              )}
            </div>

            {live && (
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={url}
                  className="h-9 text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button size="sm" onClick={() => void copy()}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                </Button>
              </div>
            )}

            {/*
             * Only ever shown for a link minted by the old dialog. New ones do
             * not expire, so saying nothing here would let a dated link look
             * permanent right up until the morning it stopped working.
             */}
            {live?.expires_at && (
              <p className="text-xs text-amber-600">
                This link was set to expire on{" "}
                {new Date(live.expires_at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                . Turn sharing off and on again to replace it with one that does not.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
