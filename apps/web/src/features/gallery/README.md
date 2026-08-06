# Gallery feature

- `pages/GalleryPage.tsx` — global gallery UI. Two views, switched in the filter
  bar: the photo **grid**, and the **calendar**.
- `components/PhotoCalendar.tsx` — month view. Each day cell is a thumbnail of
  that day's first capture with a count badge; picking a day lists its photos
  in the side panel.
- `api.ts` — privileged `/v1/rpc` adapters for this feature

Route: `src/routes/_app.gallery.tsx` (thin).

## Date handling

In grid view the Date pill drives `dateFrom`/`dateTo`. In calendar view the
visible month *is* the range — `rangeFrom`/`rangeTo` are derived from it, the
Date pill is hidden, and the row limit is raised (a single month is a much
smaller slice than "everything recent"). Both feed the same
`qk.galleryPhotos` query key, so each month caches separately.
