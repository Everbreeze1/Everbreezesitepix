# Gallery feature

- `pages/GalleryPage.tsx` - global gallery UI. Two views, switched in the filter
  bar: the photo **grid**, and the **calendar**.
- `components/PhotoCalendar.tsx` - the calendar. Month view where each day cell
  is a thumbnail of that day's last capture with a count badge, a year heatmap
  behind the same header, and a side panel listing the picked day's photos.
- `api.ts` - privileged `/v1/rpc` adapters for this feature

Route: `src/routes/_app.gallery.tsx` (thin). `?view=calendar` opens straight
into the calendar; `/timeline` redirects here.

## One calendar, two hosts

`PhotoCalendar` is also the project page's **Calendar** tab (`?panel=calendar`,
still accepting the old `?panel=timeline`), scoped with `projectIds`. It used to
be a separate `features/timeline` component plus a Pro-gated company-wide
`/timeline` page; both were the same day-by-day view of the same photos with
fewer controls, so they were folded in here.

## How it loads

The grid pages photos; the calendar does not. Day counts come from the
`listTimelineActivity` aggregate, and only the day you open is fetched as
photos. That matters for both cost and honesty: counting a client-side page of
photos meant a month heavier than the row limit silently under-reported, and a
calendar whose numbers are quietly short is worse than no calendar.

Consequences worth knowing:

- The photo query in `GalleryPage` is **disabled** in calendar view. `photos`
  is filled from the calendar's selected day instead (`onDayPhotosChange`), so
  the lightbox, tag filter and per-photo panels work the same in both views.
- Project and tag filters are passed to the aggregate, so day counts respect
  them rather than only the photos already downloaded.
- Days bucket on `taken_at`, falling back to `created_at` - a photo shot at 6pm
  and synced the next morning belongs to the day the crew was on site. The
  server over-fetches a few days past each end of the range to catch that drift
  and trims afterwards.
