-- THE BACKFILL PLACED PROJECTS ON OTHER TEAMS' BOARDS. UNDO THAT.
--
-- Step 4 of 20260917000000_pipeline_stages.sql gave each project the stage its
-- old tags put it in:
--
--     FROM public.project_tags pt
--     JOIN public.pipeline_stages ps ON ps.legacy_tag_id = pt.tag_id
--     JOIN public.project_boards b ON b.id = ps.board_id
--
-- and never asked whose board `b` was. That would have been harmless if tags
-- were team-scoped. They are not: `public.tags` has no team_id and is written
-- by `ensureGlobalTag` in apps/web/src/hooks/use-tag-colors.tsx as one shared
-- vocabulary. So a tag id listed in one team's board matched `project_tags`
-- rows belonging to every other team that had ever used the same tag.
--
-- On this database that put 12 of the 13 placed projects onto a board owned by
-- a team their owner does not belong to.
--
-- NOTHING WAS EXPOSED. RLS on pipeline_stages and project_boards still hides
-- the board from those owners, and RLS on projects still hides those projects
-- from the board's team, so neither side could see the other. The damage is
-- that 12 projects are marked as standing in a pipeline they are not in, and
-- their owners cannot clear it: the stage chip resolves a stage id against the
-- boards they can read, misses, and renders nothing to clear.
--
-- Going forward the live path cannot do this. `setProjectPipelineStage`
-- (apps/api/src/domains/projects/boards.ts) reads the stage through the
-- caller's own client first, and the RLS SELECT policy on pipeline_stages only
-- returns stages on boards of a team the caller belongs to. Only the backfill,
-- which ran as service_role with RLS off, could cross a team boundary. Step 4
-- in 20260917000000 has been corrected in place for anyone applying it fresh.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run, and a no-op once it has run.

-- A project's team is its owner's team. `projects` carries no team_id, so
-- created_by through team_members is the same rule every other cross-team check
-- in this schema uses.
UPDATE public.projects p
   SET pipeline_stage_id = NULL
 WHERE p.pipeline_stage_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
     FROM public.pipeline_stages ps
     JOIN public.project_boards b ON b.id = ps.board_id
     JOIN public.team_members tm ON tm.team_id = b.team_id
     WHERE ps.id = p.pipeline_stage_id
       AND tm.user_id = p.created_by
   );

-- Say what is left, so applying this in the SQL editor reports rather than
-- going quiet.
DO $$
DECLARE
  placed  integer;
  strays  integer;
BEGIN
  SELECT count(*) INTO placed
  FROM public.projects
  WHERE pipeline_stage_id IS NOT NULL AND deleted_at IS NULL;

  SELECT count(*) INTO strays
  FROM public.projects p
  WHERE p.pipeline_stage_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.pipeline_stages ps
      JOIN public.project_boards b ON b.id = ps.board_id
      JOIN public.team_members tm ON tm.team_id = b.team_id
      WHERE ps.id = p.pipeline_stage_id
        AND tm.user_id = p.created_by
    );

  RAISE NOTICE 'pipeline_stage_id: % project(s) placed, % on another team''s board.', placed, strays;
END $$;
