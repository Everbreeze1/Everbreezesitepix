-- Do the Summary rows on a job cover the SAME photos, or different ones?
--
--   npx supabase db query --linked -f scripts/sql/check-summary-photo-sets.sql
--
-- Read only: one SELECT, no writes.
--
-- This is the question the fix turns on for a job whose summaries have no
-- walkthrough behind them. Every row on 194 Daniels Drive has `walkthrough_id`
-- null, so there is no recording to group them by and the grouping key is the
-- set of photo ids in `photo_notes` instead. Rows sharing a `photo_set` hash
-- are one summary drafted more than once, and the Report keeps only the newest
-- of them. Rows with different hashes are summaries of different selections,
-- and the Report keeps each - correctly, but it means more than one block.
--
-- `notes` being 9 on every row is suggestive, not sufficient: nine photos twice
-- can be two different nines. The hash is what settles it.
--
-- `id_key_missing` is the other thing that would break the grouping silently. A
-- note is keyed on `photoId`, camelCase, both in the app
-- (apps/api/src/domains/walkthroughs/summaries.ts) and in the row the split
-- migration wrote. A row whose notes use some other spelling contributes no ids,
-- falls out of photo-set grouping, and reappears as its own block.

select
  left(s.id::text, 8) as ref,
  to_char(s.created_at, 'YYYY-MM-DD HH24:MI') as created,
  jsonb_array_length(coalesce(s.photo_notes, '[]'::jsonb)) as notes,
  count(distinct n->>'photoId') as distinct_photos,
  count(*) filter (where n->>'photoId' is null) as id_key_missing,
  left(md5(string_agg(distinct n->>'photoId', ',' order by n->>'photoId')), 12) as photo_set,
  left(regexp_replace(coalesce(s.markdown, ''), '\s+', ' ', 'g'), 45) as opens
from public.walkthrough_summaries s
  join public.projects p on p.id = s.project_id
  left join lateral jsonb_array_elements(coalesce(s.photo_notes, '[]'::jsonb)) n on true
where p.name ilike '%daniels%'
group by s.id, s.created_at, s.photo_notes, s.markdown
order by s.created_at desc;
