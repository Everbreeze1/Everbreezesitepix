import { api } from "@/lib/api";
import { publicUrl } from "./sharing";
import type { SummaryPhotoNote, WalkthroughSummary } from "./summary-view";

/**
 * Walkthrough summaries: what a walk was written up as.
 *
 * The phone could record a walkthrough - video, photos, transcription - and
 * then had nothing to show for it. Eight of the twenty walkthrough ops were
 * wired and the entire summary cluster was not, so the artefact the recording
 * exists to produce was reachable only from a desk.
 *
 * A summary is one of the product's three AI artefacts, and the only one with
 * two ways in: written from a recording, or written from photographs alone with
 * no walk behind it (`walkthroughId` null). Both land in the same table and
 * render the same way, which is why one screen covers them.
 *
 * Nothing here is queued through the outbox. Every generate spends an LLM call
 * and the ops are registered idempotent for exactly that reason; a queued
 * generate that fired twenty minutes late, against photos somebody has since
 * changed, would bill for a summary of a job that no longer looks like that.
 */

export type { WalkthroughSummary, SummaryPhotoNote } from "./summary-view";

/** A row in the project's list of write-ups. */
export type SummaryListItem = WalkthroughSummary & {
  photoCount: number;
  thumbUrl: string | null;
};

/** A summary's photo, with its note and a signed URL. */
export type ResolvedSummaryPhoto = SummaryPhotoNote & {
  imageUrl: string;
  caption: string | null;
  takenAt: string | null;
};

export type SummaryDetail = {
  summary: WalkthroughSummary;
  projectName: string | null;
  photos: ResolvedSummaryPhoto[];
};

/**
 * What has been written up on this job.
 *
 * Deliberately separate from `listProjectWalkthroughs`: that answers "what did
 * we record", this answers "what have we written up". The two were one list
 * once and conflating them produced a feed of mixed row types.
 */
export async function listProjectSummaries(projectId: string): Promise<SummaryListItem[]> {
  const result = await api.rpc<SummaryListItem[]>("listProjectSummaries", { projectId });
  // The service returns the array itself rather than wrapping it.
  return Array.isArray(result) ? result : [];
}

export async function getSummary(summaryId: string): Promise<SummaryDetail> {
  const result = await api.rpc<Partial<SummaryDetail>>("getWalkthroughSummary", { summaryId });
  if (!result?.summary) throw new Error("Summary not found");
  return {
    summary: result.summary,
    projectName: result.projectName ?? null,
    photos: result.photos ?? [],
  };
}

/**
 * Write a summary from photographs, with no walk behind it.
 *
 * The idempotency key is per attempt rather than per photo set, and that is the
 * right way round here: asking for a second summary of the same photos is a
 * legitimate thing to want (the first one read badly), whereas a retry after a
 * dropped response must not bill twice. A fresh key per tap, reused across the
 * retries of that one tap, gives both.
 */
export async function generateSummaryFromPhotos(input: {
  projectId: string;
  photoIds: string[];
  title?: string;
  idempotencyKey: string;
}): Promise<{ summaryId: string | null }> {
  const result = await api.rpc<{ summary?: { id?: string }; summaryId?: string }>(
    "generateSummaryFromPhotos",
    {
      projectId: input.projectId,
      photoIds: input.photoIds,
      ...(input.title ? { title: input.title } : {}),
    },
    { idempotencyKey: input.idempotencyKey },
  );
  return { summaryId: result?.summary?.id ?? result?.summaryId ?? null };
}

/** Write it again from the same source. Spends another LLM call. */
export async function regenerateSummary(walkthroughId: string): Promise<void> {
  await api.rpc("regenerateWalkthroughSummary", { walkthroughId });
}

/** Edit the title or the body by hand. */
export async function updateSummary(input: {
  summaryId: string;
  title?: string;
  markdown?: string;
}): Promise<void> {
  await api.rpc("updateWalkthroughSummary", {
    summaryId: input.summaryId,
    // Omitted rather than sent undefined: the service patches only the keys it
    // is given, so sending a key at all is what decides it gets written.
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.markdown === undefined ? {} : { markdown: input.markdown }),
  });
}

export async function deleteSummary(summaryId: string): Promise<void> {
  await api.rpc("deleteWalkthroughSummary", { summaryId });
}

/**
 * Issue or revoke the summary's own public link.
 *
 * Independent of the recording's link, which is a distinction worth preserving
 * on the phone: a client can be sent the write-up without being sent the video
 * of somebody walking round their building narrating it.
 */
export async function setSummaryShare(summaryId: string, enable: boolean): Promise<string | null> {
  const result = await api.rpc<{ token?: string | null; shareToken?: string | null }>(
    "setSummaryShare",
    { summaryId, enable },
  );
  return result?.token ?? result?.shareToken ?? null;
}

/**
 * The public URL for a shared summary, or null when sharing is not set up.
 *
 * Through `publicUrl` rather than assembling the path here. The first version
 * of this built the string itself and so kept a seventh copy of a route prefix
 * that `share-links.ts` exists to hold once - the exact duplication that module
 * was written to end.
 */
export function summaryShareUrl(token: string | null): string | null {
  return publicUrl("summaries", token);
}
