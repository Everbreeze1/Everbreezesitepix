import { Share } from "react-native";
import { api, webAppUrl } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { shareUrl, shareTogglePatch, type ShareKind } from "./share-links";

/**
 * Handing a record to someone outside the workspace.
 *
 * Four kinds, three different mechanisms, because the product grew them
 * separately and the shapes are already in use by the web app:
 *
 *   projects      `ensureProjectShare` mints a token if there is not one
 *   photos        `createPhotoShare` mints a fresh token, with an expiry
 *   checklists    a `share_token` already on the row, toggled by `revoked_at`
 *   workflows     the same as checklists
 *
 * Mobile is not inventing a fifth. Walkthrough sharing already exists in
 * `walkthroughs.ts` and stays there.
 *
 * None of this is queued. A share link is only useful once it exists on the
 * server and can be opened by someone else, so an offline "share" would hand
 * the user a URL that resolves to nothing. The callers surface the failure
 * instead.
 */

export { shareUrl, isShareLive, type ShareKind } from "./share-links";

/**
 * Open the system share sheet.
 *
 * The native sheet rather than a copy-to-clipboard button, because the link is
 * going to a customer or an inspector and the phone already knows which apps
 * the crew uses to reach them.
 */
export async function openShareSheet(url: string, title?: string): Promise<void> {
  await Share.share({ message: url, title });
}

/** A project's public link, minting one if the project has never been shared. */
export async function ensureProjectShareToken(projectId: string): Promise<string | null> {
  const result = (await api.rpc("ensureProjectShare", { projectId })) as {
    shareToken?: string | null;
  } | null;
  return result?.shareToken ?? null;
}

/**
 * Whether a project's public link is currently live.
 *
 * Read separately rather than added to the project row, because the two columns
 * (`share_token`, `share_revoked_at`) are not on the mobile row's select and
 * widening that select would put a token on every project in the list - a page
 * of jobs would then carry a page of live URLs in memory for a screen that
 * shows none of them.
 */
export type ProjectShareState = { shareToken: string | null; revokedAt: string | null };

export async function getProjectShareState(projectId: string): Promise<ProjectShareState> {
  const result = await api.rpc<Partial<ProjectShareState>>("getProjectShare", { projectId });
  return {
    shareToken: result?.shareToken ?? null,
    revokedAt: result?.revokedAt ?? null,
  };
}

/**
 * Turn a project's link on or off without destroying the token.
 *
 * The half the phone was missing, and the one that matters more: it could mint
 * a link to a whole job - every photograph on it, readable by anyone holding
 * the URL with no login - and had no way to switch it off again. Documents and
 * walkthrough write-ups both had a "Stop sharing"; the project itself, which is
 * the largest thing that can be exposed, did not.
 *
 * Switching off stamps `share_revoked_at` and keeps the token, so turning it
 * back on restores the SAME url rather than stranding a link already sent.
 */
export async function setProjectShareEnabled(projectId: string, enable: boolean): Promise<void> {
  await api.rpc("setProjectShare", { projectId, enable });
}

/**
 * A shareable link to one photo.
 *
 * `expiresInHours` defaults to a week. A photo link is usually sent to settle a
 * question that is live right now ("is this the crack you meant"), and a link
 * that outlives the conversation is a copy of site imagery sitting on the open
 * internet indefinitely. Zero means never expire, which the caller has to ask
 * for deliberately.
 */
export async function createPhotoShareToken(
  photoId: string,
  expiresInHours = 24 * 7,
  /**
   * Whether the recipient may save the file, rather than only look at it.
   *
   * **Required by the schema, and omitting it was a live outage.**
   * `createPhotoShareInputSchema` declares `allowDownload: z.boolean()` with no
   * default and no `.optional()`, and the registry runs `.parse()` on the way
   * in, so a request without it was rejected before the service ever ran: every
   * Share tap on the phone failed. Nothing caught it because the op name was
   * real, the two fields sent were real, and the client declares its own types.
   *
   * True, matching both web call sites. A client sent a photograph to settle a
   * question usually needs to keep it, and a link that renders an image the
   * browser will not save is a puzzle rather than a policy.
   */
  allowDownload = true,
): Promise<string | null> {
  const result = (await api.rpc("createPhotoShare", {
    photoId,
    expiresInHours,
    allowDownload,
  })) as {
    token?: string | null;
  } | null;
  return result?.token ?? null;
}

/** A link already minted for a photo. Field names are the server's. */
export type PhotoShare = {
  id: string;
  token: string;
  expires_at: string | null;
  allow_download: boolean;
  created_at: string;
  revoked_at: string | null;
};

/**
 * Every link ever minted for this photo.
 *
 * Needed because the phone could mint them and never see them again. Each tap
 * of Share creates a **fresh** token rather than reusing one, so three taps
 * leave three independently live URLs pointing at the same site photograph,
 * and until now there was no way to count them, let alone withdraw one.
 */
export async function listPhotoShares(photoId: string): Promise<PhotoShare[]> {
  // The service returns the rows directly rather than wrapping them, unlike
  // most ops here. Guarded so a shape change renders empty instead of throwing.
  const result = await api.rpc<PhotoShare[]>("listPhotoShares", { photoId });
  return Array.isArray(result) ? result : [];
}

/** Withdraw one link. Stamps `revoked_at`; the token stops resolving. */
export async function revokePhotoShare(shareId: string): Promise<void> {
  await api.rpc("revokePhotoShare", { shareId });
}

/** The two record tables that carry their own `share_token` and `revoked_at`. */
export type ShareableRecordTable = "project_checklists" | "project_workflows";

/**
 * Turn a checklist or workflow link on or off.
 *
 * A direct RLS update, matching `ShareRecordDialog.tsx`. The token is minted
 * when the row is created and never changes, so switching sharing back on
 * restores the same URL rather than invalidating one already sent.
 */
export async function setRecordShareEnabled(
  table: ShareableRecordTable,
  recordId: string,
  enable: boolean,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update(shareTogglePatch(enable) as never)
    .eq("id", recordId);

  if (error) throw new Error(error.message);
}

/** Builds a link against the configured web origin. */
export function publicUrl(kind: ShareKind, token: string | null): string | null {
  return shareUrl(webAppUrl, kind, token);
}
