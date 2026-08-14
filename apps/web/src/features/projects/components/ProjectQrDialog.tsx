"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Loader2, Printer, QrCode, RefreshCw, Share2 } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

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
import { PrintDocument } from "@/components/PrintDocument";
import { ensureProjectShare, setProjectShare } from "@/lib/project-shares.functions";

/**
 * The QR code for a project, and the public link behind it.
 *
 * Replaces a menu item that generated a code and pushed a PNG straight at the
 * browser. Two things were wrong with that, both reported from the field:
 *
 *  1. The code encoded `/projects/<id>`, an authenticated route, so every scan
 *     asked the person holding the phone to sign in. The point of a code taped
 *     to a door is that the homeowner, the inspector and the sub can all read
 *     the job without an account, so it now encodes the project's public share
 *     link instead.
 *
 *  2. The download itself never showed anyone what they were getting: a `data:`
 *     URL on a detached `<a download>`, which Safari does not treat as a
 *     download at all - it navigates, and macOS hands the result to Preview.
 *     "It opens an odd file" is exactly what that looks like from the outside.
 *     The bytes now go through a Blob and an anchor that is actually in the
 *     document, and the code is on screen before anything is saved.
 *
 * Opening this dialog is what publishes the link, the first time and only the
 * first time - see `load`. A code that arrives dead is a code the owner has to
 * be told about, and asking someone who just opened *QR code for this job*
 * whether they meant it is a question with one answer. After that first open the
 * switch is theirs alone: a link they turn off is never turned back on by
 * looking at it, which is a guarantee held in the database rather than here (see
 * `ensureProjectShareService` and 20260818000300).
 *
 * The dialog shows one state at a time, and says each thing once. While the link
 * is off it is a greyed code and the button that turns it on - the switch, the
 * link box, "Save PNG" and "Print sheet" all describe a code that leads nowhere,
 * and the caption under it said what the button already says. While it is on,
 * the ways to hand the link over are the ways a phone can actually hand it over:
 * the OS share sheet where there is one, Copy and Print everywhere.
 */

function slugify(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "project";
}

/**
 * `data:` URL to a real Blob.
 *
 * Chrome will download a `data:` href; Safari will not, and Firefox refuses a
 * detached anchor. An object URL from a Blob is the one form all three treat as
 * a file - which is the actual bug behind "Save QR code opens a PDF".
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, base64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] ?? "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function ProjectQrDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectAddress,
  companyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectAddress: string | null;
  companyName?: string | null;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toggling, setToggling] = useState(false);
  /*
   * Web Share exists on phones and on almost no desktop browser, and it is the
   * difference between "send this to the customer" being one tap or a
   * copy-paste into another app. Read in an effect rather than at render: this
   * component is reachable from a route that server-renders, and `navigator` is
   * not a thing there.
   */
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = token ? `${origin}/share/projects/${token}` : "";

  /**
   * Reads the link, and publishes it if it has never been decided either way.
   *
   * Note what this cannot become. The menu mounts this dialog as
   * `{qrOpen && …}`, so it unmounts on close and every open starts from blank
   * state - an "enable on open" effect written here would fire on *every* open,
   * not once, and would silently re-publish the photos of an owner who switched
   * the link off when the job finished, landing them in a success state
   * indistinguishable from the one they deliberately left.
   *
   * So the "first" in "first open" is not counted here. It is a column:
   * `share_decided_at`, NULL until someone answers the question and never NULL
   * again, and the publish is the WHERE clause of a single UPDATE against it.
   * This component may call `load` as often as it likes; the second call and
   * every call after it is a plain read.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await ensureProjectShare({ data: { projectId } });
      setToken(res.shareToken);
      setLive(!res.revokedAt);
    } catch (e: any) {
      setFailed(true);
      toast.error(e?.message ?? "Could not load the public link");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open || token || loading || failed) return;
    void load();
  }, [open, token, loading, failed, load]);

  useEffect(() => {
    if (!url) {
      setQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 1024,
      margin: 2,
      // Level Q recovers from ~25% damage. These get printed and taped to a
      // stud in the weather, and the URL is short enough that the extra
      // redundancy costs nothing a phone camera will notice.
      errorCorrectionLevel: "Q",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((d) => {
        if (!cancelled) setQr(d);
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not generate the QR code");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function toggle(next: boolean) {
    setToggling(true);
    try {
      const res = await setProjectShare({ data: { projectId, enable: next } });
      setToken(res.shareToken);
      setLive(!res.revokedAt);
      toast.success(next ? "Link is live" : "Link turned off - the printed code stops working");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the link");
    } finally {
      setToggling(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy - select the link and copy it manually");
    }
  }

  /**
   * Hand the link to Messages, WhatsApp, Mail - whatever the phone offers.
   *
   * The link, not the QR image: the recipient is reading it on the device they
   * were sent it on, and a photo of a code they would have to scan with a
   * second phone is the long way round. Dismissing the sheet is a cancel, not a
   * failure; anything else falls back to the clipboard so the tap still leaves
   * them holding the link.
   */
  async function share() {
    if (!url) return;
    try {
      await navigator.share({ title: projectName, text: `Photos from ${projectName}`, url });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      await copy();
    }
  }

  function download() {
    if (!qr) return;
    const objectUrl = URL.createObjectURL(dataUrlToBlob(qr));
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `${slugify(projectName)}-qr.png`;
    // In the document, not detached: Firefox ignores a synthetic click otherwise.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking in the same tick can beat the browser to the bytes.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    toast.success("QR code saved");
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>QR code for “{projectName}”</DialogTitle>
            <DialogDescription>
              Scanning it opens this job’s photos in any browser - no app, no account, no sign-in.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center">
            <div className="flex h-52 w-52 items-center justify-center rounded-xl border border-border bg-white p-3">
              {loading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : failed ? (
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Try again
                </Button>
              ) : qr ? (
                <img
                  src={qr}
                  alt={`QR code linking to ${projectName}`}
                  className={live ? "h-full w-full" : "h-full w-full opacity-25"}
                />
              ) : (
                <QrCode className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
          </div>

          {/*
            Off: one sentence and the button that changes it. On: the switch that
            takes it back down, the link, and the ways to pass it on. Nothing
            that describes a dead code - offering "Save PNG" on one is offering
            to print a sign that sends customers to an error page.
          */}
          {live ? (
            <>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/25 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Anyone can scan it</p>
                  <p className="text-xs text-muted-foreground">
                    Visitors see this job’s name, address and photos - nothing else, and nothing
                    they can change.
                  </p>
                </div>
                {toggling ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={live}
                    disabled={!token}
                    onCheckedChange={(v) => void toggle(v)}
                    aria-label="Public link"
                  />
                )}
              </div>

              {url && (
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={url}
                    className="h-9 text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button size="sm" variant="outline" onClick={() => void copy()}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                {/* Only where the OS has a share sheet to open - see `canShare`. */}
                {canShare && (
                  <Button className="flex-1" disabled={!url} onClick={() => void share()}>
                    <Share2 className="mr-2 h-4 w-4" />
                    Send link
                  </Button>
                )}
                <Button variant="outline" className="flex-1" disabled={!qr} onClick={download}>
                  <Download className="mr-2 h-4 w-4" />
                  Save PNG
                </Button>
                <Button
                  variant={canShare ? "outline" : "default"}
                  className="flex-1"
                  disabled={!qr}
                  onClick={() => window.print()}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print sheet
                </Button>
              </div>
            </>
          ) : (
            <>
              {/*
                Reaching this state now means the link was switched off - by
                this owner, or by the backfill that closed every project created
                before first-open publishing existed. "Yet" would be a guess
                about which; the sentence is true without it.
              */}
              <p className="text-center text-sm text-muted-foreground">
                The link is off, so this code leads nowhere.
              </p>
              {/* The one action that makes sense while the link is off, as the
                  primary button rather than a switch someone has to notice. */}
              <Button
                className="w-full"
                disabled={!token || toggling}
                onClick={() => void toggle(true)}
              >
                {toggling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="mr-2 h-4 w-4" />
                )}
                Turn the link on
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/*
        The printable sheet - a poster, not a screenshot of this dialog.
        PrintDocument hides every other body child while it is mounted, so the
        browser's own Ctrl+P produces the same page as the button.
      */}
      {open && qr && live && (
        <PrintDocument>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "95vh",
              textAlign: "center",
              color: "#111827",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {companyName && (
              <p style={{ fontSize: "14pt", fontWeight: 600, margin: 0 }}>{companyName}</p>
            )}
            <h1 style={{ fontSize: "26pt", fontWeight: 700, margin: "6pt 0 0" }}>{projectName}</h1>
            {projectAddress && (
              <p style={{ fontSize: "12pt", color: "#4b5563", margin: "4pt 0 0" }}>
                {projectAddress}
              </p>
            )}
            <img src={qr} alt="" style={{ width: "108mm", height: "108mm", margin: "10mm 0 0" }} />
            <p style={{ fontSize: "16pt", fontWeight: 600, margin: "6mm 0 0" }}>
              Scan to see photos from this job
            </p>
            <p style={{ fontSize: "10pt", color: "#6b7280", margin: "3mm 0 0" }}>
              Point your phone camera at the code. No app or account needed.
            </p>
          </div>
        </PrintDocument>
      )}
    </>
  );
}
