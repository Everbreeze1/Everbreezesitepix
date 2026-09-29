import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { PhotoPatch } from "@/api/photo-edit";
import type { PhotoDetail } from "@/api/photo-viewer";
import type { PhotoListItem } from "@/api/photos";
import { photoPatchRowId, type PhotoPatchPayload } from "@/offline/handlers";
import { enqueue } from "@/offline/outbox";
import { refreshQueue, requestSync } from "@/offline/sync";

type Paged = { pages: { photos: PhotoListItem[] }[] };

function patchPages<T extends Paged>(data: T | undefined, id: string, patch: PhotoPatch) {
  if (!data?.pages) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      photos: page.photos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    })),
  };
}

/**
 * Write the change into every cache a photo is read from.
 *
 * The viewer can be opened from the project grid, the library or the calendar,
 * and each keeps its own copy of the row. Patching all of them means the tile
 * behind the viewer shows the new tag the moment the viewer closes, rather than
 * after the queue drains and a refetch lands.
 */
export function patchPhotoCaches(queryClient: QueryClient, id: string, patch: PhotoPatch) {
  queryClient.setQueriesData<Paged>({ queryKey: ["project-photos"] }, (data) =>
    patchPages(data, id, patch),
  );
  queryClient.setQueriesData<Paged>({ queryKey: ["gallery-photos"] }, (data) =>
    patchPages(data, id, patch),
  );
  queryClient.setQueriesData<{ photos: PhotoListItem[] }>(
    { queryKey: ["project-calendar-day"] },
    (data) =>
      data?.photos
        ? {
            ...data,
            photos: data.photos.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
          }
        : data,
  );
  queryClient.setQueryData<PhotoDetail | null>(["photo-detail", id], (data) =>
    data ? { ...data, ...patch } : data,
  );
}

/**
 * Edit one photo from the viewer: its tags, description or phase.
 *
 * Optimistic and queued, like every other photo write in the app, so tagging a
 * photo in a basement is recorded rather than lost. Each field keys its own
 * queue row, so a tag change and a description edit cannot overwrite each
 * other, while two tag changes in a row collapse into the last one (the patch
 * carries the whole tag list).
 */
export function usePhotoEdit(onLocal: (id: string, patch: PhotoPatch) => void) {
  const queryClient = useQueryClient();
  return useCallback(
    async (photoId: string, projectId: string | null, field: string, patch: PhotoPatch) => {
      onLocal(photoId, patch);
      patchPhotoCaches(queryClient, photoId, patch);
      const payload: PhotoPatchPayload & { invalidate: unknown[][] } = {
        photoIds: [photoId],
        patch,
        invalidate: [["project-photos", projectId], ["gallery-photos"], ["photo-detail", photoId]],
      };
      await enqueue({
        id: photoPatchRowId(field, [photoId]),
        kind: "photo_patch",
        projectId,
        payload,
      });
      await refreshQueue();
      requestSync();
    },
    [queryClient, onLocal],
  );
}
