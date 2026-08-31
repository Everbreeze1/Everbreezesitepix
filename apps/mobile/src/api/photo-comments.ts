import { api } from "@/lib/api";
import { getMyTeam } from "./team";
import type { Mentionable, PhotoComment } from "./photo-comments-view";

/**
 * Comments on a photograph.
 *
 * Four existing `/v1/rpc` ops, none of which could be a direct RLS write:
 * posting a comment also raises a notification for everybody mentioned, and
 * reading one joins `profiles` for the author's name and avatar, which the
 * client is not allowed to select across.
 *
 * **Nothing here goes through the offline outbox**, and unlike the team screens
 * that is a technical limit rather than a product decision. Every other queued
 * write is idempotent: the patch carries the whole value, or the row id travels
 * in the payload so a replay lands on the same row. `createPhotoComment` mints
 * its id server-side and the input schema has nowhere to put one, so a queued
 * comment that was sent but whose response was lost would post twice on retry.
 * Two identical comments under a photo, and two notifications to whoever was
 * mentioned, is worse than a comment that fails and says so.
 *
 * Making it queueable is a small change on both sides: accept an optional
 * client-generated `commentId` and insert with it, the way `createTask` does.
 * Worth doing if comments turn out to be written in basements.
 */

export type { PhotoComment, Mentionable } from "./photo-comments-view";

export async function listPhotoComments(photoId: string): Promise<PhotoComment[]> {
  const result = await api.rpc<{ comments?: PhotoComment[] }>("listPhotoComments", { photoId });
  return result.comments ?? [];
}

export async function createPhotoComment(input: {
  photoId: string;
  projectId: string;
  body: string;
  mentions: string[];
}): Promise<PhotoComment> {
  const result = await api.rpc<{ comment: PhotoComment }>("createPhotoComment", {
    photoId: input.photoId,
    projectId: input.projectId,
    // Trimmed here as well as on the server: the server trims for validation
    // but stores what it was given, so an untrimmed body would render with the
    // stray newline somebody hit by accident.
    body: input.body.trim(),
    mentions: input.mentions,
  });
  return result.comment;
}

export async function deletePhotoComment(commentId: string): Promise<void> {
  await api.rpc("deletePhotoComment", { commentId });
}

/**
 * Who can be mentioned.
 *
 * The team roster rather than a per-project contributor list, matching the web
 * panel. It means somebody who has never touched this job can be mentioned,
 * which is the right way round: pulling a colleague into a photo they have not
 * seen is most of the reason to mention anyone.
 */
export async function listMentionable(): Promise<Mentionable[]> {
  const team = await getMyTeam();
  return team.members.map((member) => ({
    userId: member.user_id,
    fullName: member.profile?.full_name ?? null,
    email: member.profile?.email ?? null,
  }));
}
