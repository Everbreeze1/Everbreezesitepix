-- The Summary rows on a job, and what each Report already filed there quoted.
--
--   npx supabase db query --linked -f scripts/sql/check-report-summary-history.sql
--
-- Read only: one SELECT, no writes.
--
-- ONE result set on purpose. `supabase db query -f` prints only the LAST
-- statement's output, so a file of three tidy SELECTs silently answers one
-- third of what it asks. Both halves are therefore folded into a single union
-- with a `kind` column separating them.
--
-- Written for the 194 Daniels Drive complaint, "the report shows four
-- near-identical 'Summary' blocks in its body instead of one". What the rows
-- tell you:
--
--   `summary row` with the same `walk` more than once  - one recording
--       summarised repeatedly. Each Regenerate inserts a row; the newest is the
--       current one and the rest are superseded.
--   `summary row` with walk `-` and the same photo count repeatedly - a summary
--       written from photos, generated more than once over the same selection.
--
-- Either history produced four blocks and the fix covers both, but knowing
-- which one this job has is the difference between a verified fix and an
-- assumed one.
--
--   `filed report` blocks=N  - N is what that stored document carries TODAY.
--       content_html is written at generation time, so a Report generated
--       before the fix keeps its four blocks until somebody regenerates it.
--       A high N on an old row is the bug as reported. A high N on a row
--       generated after the fix is the fix having failed - that is the one to
--       tell me about.
--
-- Change the two `ilike` fragments for a different job.

with summaries as (
  select
    s.created_at,
    left(s.id::text, 8) as ref,
    'walk ' || coalesce(left(s.walkthrough_id::text, 8), '-')
      || ' | notes ' || jsonb_array_length(coalesce(s.photo_notes, '[]'::jsonb))::text
      || ' | ' || length(coalesce(s.markdown, ''))::text || ' chars'
      || ' | walked ' || coalesce(to_char(w.started_at, 'YYYY-MM-DD'), '-')
      || ' | ' || coalesce(s.title, '(untitled)')
      || ' | ' || left(regexp_replace(coalesce(s.markdown, ''), '\s+', ' ', 'g'), 60) as detail
  from public.walkthrough_summaries s
    left join public.walkthroughs w on w.id = s.walkthrough_id
    join public.projects p on p.id = s.project_id
  where p.name ilike '%daniels%'
),
reports as (
  select
    pg.created_at,
    left(pg.id::text, 8) as ref,
    'blocks=' || (
      (
        length(split_part(pg.content_html, '<h2>Walkthrough Summaries</h2>', 2))
        - length(
            replace(split_part(pg.content_html, '<h2>Walkthrough Summaries</h2>', 2), '<h3>', '')
          )
      ) / length('<h3>')
    )::text
      || ' | ' || coalesce(pg.title, '(untitled)') as detail
  from public.project_pages pg
    join public.projects p on p.id = pg.project_id
  where p.name ilike '%daniels%'
    and pg.source_template = 'report'
)
select 'summary row' as kind, created_at, ref, detail from summaries
union all
select 'filed report' as kind, created_at, ref, detail from reports
order by created_at desc;
