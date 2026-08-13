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
import { getProjectShare, setProjectShare } from "@/lib/project-shares.functions";

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
 *     download at all — it navigates, and macOS hands the result to Preview.
 *     "It opens an odd file" is exactly what that looks like from the outside.
 *     The bytes now go through a Blob and an anchor that is actually in the
 *     document, and the code is on screen before anything is saved.
 *
 * Opening this dialog reads the link's state and changes nothing — see `load`.
 * Publishing is one tap, on a primary button that is the only action offered
 * while the link is off, and what a visitor will see is stated next to it rather
 * than buried in a help page.
 */

function slugify(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "project";
}

/**
 * `data:` URL to a real Blob.
 *
 * Chrome will download a `data:` href; Safari will not, and Firefox refuses a
 * detached anchor. An object URL from a Blob is the one form all three treat as
 * a file — which is the actual bug behind "Save QR code opens a PDF".
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

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = token ? `${origin}/share/projects/${token}` : "";

  /**
   * Reads the link. Never changes it.
   *
   * This deliberately does not turn sharing on, and the distinction is not
   * cosmetic. The menu mounts this dialog as `{qrOpen && …}`, so it unmounts on
   * close and every open starts from blank state — an "enable on open" effect
   * therefore fires *every* time, not once. An owner who switched the link off
   * when a job finished and later opened this dialog to look at it would have
   * silently re-published their customer's photos, with a success state that
   * looked identical to the one they'd deliberately left.
   *
   * Publishing stays an act. It costs one clearly-labelled tap the first time,
   * which is not the friction the field complained about — that was a login wall
   * in front of the person *scanning*, and this fixes nothing about it.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await getProjectShare({ data: { projectId } });
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
      toast.success(next ? "Link is live" : "Link turned off — the printed code stops working");
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
      toast.error("Couldn't copy — select the link and copy it manually");
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
              {live
                ? "Print it and put it on the job. Scanning opens this project’s photos in a browser — no app, no account, no sign-in."
                : "Turn the link on and this code opens the project’s photos in any browser — no app, no account, no sign-in."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3">
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
            {!live && !loading && token && (
              <p className="text-center text-xs text-muted-foreground">
                The link is off, so this code leads nowhere yet.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/25 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{live ? "Anyone can scan it" : "Link is off"}</p>
              <p className="text-xs text-muted-foreground">
                {live
                  ? "Visitors see this project's name, address and photos. They can't change anything, and they see no other project."
                  : "Turn it on to hand this job to a customer or an inspector."}
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

          {/*
            The link itself, and the two things you can do with a working code,
            appear only while the code works. Offering "Save PNG" on a dead link
            is offering to print a sign that sends customers to an error page.
          */}
          {live && url && (
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

          {live ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="flex-1" disabled={!qr} onClick={download}>
                <Download className="mr-2 h-4 w-4" />
                Save PNG
              </Button>
              <Button className="flex-1" disabled={!qr} onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print sheet
              </Button>
            </div>
          ) : (
            // The one action that makes sense while the link is off, as the
            // primary button rather than a switch someone has to notice.
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
          )}
        </DialogContent>
      </Dialog>

      {/*
        The printable sheet — a poster, not a screenshot of this dialog.
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
