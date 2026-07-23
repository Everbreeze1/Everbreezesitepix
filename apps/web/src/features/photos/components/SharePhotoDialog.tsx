import { useEffect, useState } from "react";
import { Loader2, Copy, Check, Link2, Trash2, Download, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const DURATIONS: Array<{ value: string; label: string; hours: number }> = [
  { value: "1", label: "1 hour", hours: 1 },
  { value: "24", label: "24 hours", hours: 24 },
  { value: "168", label: "7 days", hours: 24 * 7 },
  { value: "720", label: "30 days", hours: 24 * 30 },
  { value: "0", label: "Never expires", hours: 0 },
];

function shareUrl(token: string) {
  if (typeof window === "undefined") return `/share/photos/${token}`;
  return `${window.location.origin}/share/photos/${token}`;
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "Never expires";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `Expires in ${h}h`;
  return `Expires in ${Math.round(h / 24)}d`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  photoId: string | null;
}

export function SharePhotoDialog({ open, onClose, photoId }: Props) {
  const create = createPhotoShare;
  const list = listPhotoShares;
  const revoke = revokePhotoShare;

  const [duration, setDuration] = useState("168");
  const [allowDownload, setAllowDownload] = useState(true);
  const [creating, setCreating] = useState(false);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const reload = async () => {
    if (!photoId) return;
    setLoadingList(true);
    try {
      const rows = await list({ data: { photoId } });
      setShares(rows as ShareRow[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load shares");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (open && photoId) void reload();
    if (!open) {
      setCopiedId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, photoId]);

  const handleCreate = async () => {
    if (!photoId) return;
    const preset = DURATIONS.find((d) => d.value === duration) ?? DURATIONS[2];
    setCreating(true);
    try {
      const row = await create({
        data: { photoId, expiresInHours: preset.hours, allowDownload },
      });
      const r = row as ShareRow;
      setShares((s) => [r, ...s]);
      // Copy link straight away — single fewer tap.
      try {
        await navigator.clipboard.writeText(shareUrl(r.token));
        setCopiedId(r.id);
        toast.success("Share link copied to clipboard");
      } catch {
        toast.success("Share link created");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create share link");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (row: ShareRow) => {
    try {
      await navigator.clipboard.writeText(shareUrl(row.token));
      setCopiedId(row.id);
      toast.success("Link copied");
      setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  const handleRevoke = async (row: ShareRow) => {
    try {
      await revoke({ data: { shareId: row.id } });
      setShares((s) =>
        s.map((x) => (x.id === row.id ? { ...x, revoked_at: new Date().toISOString() } : x)),
      );
      toast.success("Link revoked");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not revoke");
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
            Anyone with the link can view this photo. You can revoke the link at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="share-duration"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Link expires
            </Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger id="share-duration" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <Download className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Allow download</div>
                <div className="text-xs text-muted-foreground">
                  Recipient can save the original JPEG.
                </div>
              </div>
            </div>
            <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
          </div>

          <Button onClick={handleCreate} disabled={creating || !photoId} className="w-full">
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            Create & copy link
          </Button>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Active links
              </h4>
              {loadingList && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {shares.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                No links yet for this photo.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-auto">
                {shares.map((s) => {
                  const revoked = !!s.revoked_at;
                  const expired =
                    !revoked && s.expires_at && new Date(s.expires_at).getTime() <= Date.now();
                  const dead = revoked || expired;
                  return (
                    <li
                      key={s.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${dead ? "border-border/50 bg-muted/20 opacity-60" : "border-border"}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {revoked ? "Revoked" : expired ? "Expired" : formatExpiry(s.expires_at)}
                          {s.allow_download && !dead && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                              <Download className="h-2.5 w-2.5" /> dl
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] font-mono text-muted-foreground">
                          {shareUrl(s.token)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!dead && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => void handleCopy(s)}
                              aria-label="Copy link"
                            >
                              {copiedId === s.id ? (
                                <Check className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => void handleRevoke(s)}
                              aria-label="Revoke link"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
