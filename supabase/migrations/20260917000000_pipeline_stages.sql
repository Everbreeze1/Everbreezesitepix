-- PIPELINE STAGES ARE A FIELD ON THE PROJECT, NOT A SET OF TAGS.
--
-- The review of the Pipelines tab, in the client's words:
--
--   "A project can carry multiple tags at once, so it can appear in more than
--    one column on the same board at the same time. A real pipeline stage
--    should be exclusive: a job is only ever in one place."
--
--   "Because pipelines are just saved tag selections, near-duplicate boards get
--    created by accident (same name, slightly different spelling) with
--    different columns and different projects in each, and nothing merges
--    them."
--
-- Both fall out of one decision: `project_boards.tag_ids` made a column a tag,
-- and tags are many-per-project by design. No amount of UI work makes a
-- many-to-many relation behave like a single-select one.
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
--   public.pipeline_stages     - the columns of a pipeline, owned by the board.
--                                Named, coloured and ordered here rather than
--                                borrowed from a tag, so renaming a stage never
--                                renames a tag and vice versa.
--   projects.pipeline_stage_id - the single-select field. One project, one
--                                stage, enforced by the column being scalar
--                                instead of by convention. NULL means "not in a
--                                pipeline".
--
-- A project therefore sits on at most one board, in exactly one of its columns.
-- That is the point: it is what makes "a job is only ever in one place" true of
-- the data rather than of the rendering.
--
-- `project_boards.tag_ids` is left in place by this migration so the currently
-- deployed front end keeps working while the new build rolls out. The follow-up
-- 20260918000000_project_boards_drop_tag_ids.sql removes it, and should be
-- applied once the new build is live.
--
-- ===========================================================================
-- THE THREE OPEN QUESTIONS, AND WHAT THIS ANSWERS
-- ===========================================================================
--   "Should pipeline_stage replace Active/Completed/Archived long-term?"
--     Not here. `projects.status` is untouched and stays the big-picture
--     bucket; the stage tracks movement inside it. They are deliberately not
--     wired together, so neither one silently rewrites the other, and merging
--     them later stays a decision rather than an unpick.
--
--   "Is the stage list global (one per workspace) or per board?"
--     Per board, and that is what makes "one project, one stage" hold. Stages
--     belong to a board (`pipeline_stages.board_id`) and a project points at
--     one stage, so a project sits on one board, in one of its columns. A
--     workspace-wide list would have forced the opposite: every board showing
--     the same columns, or a project needing one stage per board.
--
--   "Hard-block tags as stages, or a one-time migration?"
--     Hard block. The tag ids are carried across here, and the follow-up drops
--     the column they lived in, so afterwards there is no path from a tag to a
--     column in the UI or in SQL. Tags are unchanged for filtering and search.
--
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run.

-- ===========================================================================
-- 1. THE STAGE TABLE
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id   uuid NOT NULL REFERENCES public.project_boards(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#64748b',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_stages_board_id_idx
  ON public.pipeline_stages(board_id, position);

CREATE OR REPLACE FUNCTION public.pipeline_stages_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_stages_updated_at_trg ON public.pipeline_stages;
CREATE TRIGGER pipeline_stages_updated_at_trg
  BEFORE UPDATE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_stages_set_updated_at();

-- Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
-- TO anon`, so a new public table is readable by the publishable key in the
-- browser bundle the moment it exists. Take that back before granting anything.
REVOKE ALL ON public.pipeline_stages FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO authenticated;
GRANT ALL ON public.pipeline_stages TO service_role;

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

-- Anyone on the team can read the columns, because everyone has to be able to
-- render the board. Only owners and admins can change what the columns are,
-- matching who can already manage the board itself.
DROP POLICY IF EXISTS "Team members view pipeline stages" ON public.pipeline_stages;
CREATE POLICY "Team members view pipeline stages" ON public.pipeline_stages
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_boards b
      JOIN public.team_members tm ON tm.team_id = b.team_id
      WHERE b.id = pipeline_stages.board_id AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners/admins manage pipeline stages" ON public.pipeline_stages;
CREATE POLICY "Owners/admins manage pipeline stages" ON public.pipeline_stages
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_boards b
      JOIN public.team_members tm ON tm.team_id = b.team_id
      WHERE b.id = pipeline_stages.board_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_boards b
      JOIN public.team_members tm ON tm.team_id = b.team_id
      WHERE b.id = pipeline_stages.board_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  );

-- ===========================================================================
-- 2. THE FIELD ON THE PROJECT
-- ===========================================================================
-- ON DELETE SET NULL, not CASCADE: deleting a column must never delete the
-- jobs that were sitting in it. They fall out of the pipeline and can be put
-- back into any stage.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS pipeline_stage_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_pipeline_stage_id_fkey'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_pipeline_stage_id_fkey
      FOREIGN KEY (pipeline_stage_id)
      REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_pipeline_stage_id_idx
  ON public.projects(pipeline_stage_id)
  WHERE pipeline_stage_id IS NOT NULL;

COMMENT ON COLUMN public.projects.pipeline_stage_id IS
  'Single-select pipeline position. Separate from projects.status (the big-picture Active/Completed/Archived bucket) and from tags, which are for filtering and search only.';

-- ===========================================================================
-- 3. CARRY THE EXISTING BOARDS ACROSS
-- ===========================================================================
-- Every board that exists today is a list of tag ids. Turn each of those tags
-- into a real stage, in the same left-to-right order, keeping the tag's name
-- and colour so the board looks unchanged the first time it is opened.
--
-- `legacy_tag_id` exists only for the length of this migration: it is what
-- lets step 4 put each project back in the column it was already showing in,
-- exactly, without matching on names. It is dropped in step 7.

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS legacy_tag_id uuid;

WITH src AS (
  SELECT DISTINCT ON (b.id, lower(regexp_replace(t.name, '[^[:alnum:]]', '', 'g')))
         b.id                                     AS board_id,
         t.id                                     AS tag_id,
         t.name                                   AS name,
         COALESCE(NULLIF(t.color, ''), '#64748b') AS color,
         tag.ord                                  AS ord
  FROM public.project_boards b
  CROSS JOIN LATERAL unnest(b.tag_ids) WITH ORDINALITY AS tag(tag_id, ord)
  JOIN public.tags t ON t.id = tag.tag_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages ps WHERE ps.board_id = b.id
  )
  -- Two tags whose names differ only in case or punctuation would have drawn
  -- two columns that read identically. Keep the leftmost.
  ORDER BY b.id, lower(regexp_replace(t.name, '[^[:alnum:]]', '', 'g')), tag.ord
)
INSERT INTO public.pipeline_stages (board_id, name, color, position, legacy_tag_id)
SELECT board_id,
       name,
       color,
       (row_number() OVER (PARTITION BY board_id ORDER BY ord))::int - 1,
       tag_id
FROM src;

-- A board whose tags were all deleted, or which never had any, gets the
-- default set rather than staying an empty screen.
INSERT INTO public.pipeline_stages (board_id, name, color, position)
SELECT b.id, d.name, d.color, d.position
FROM public.project_boards b
CROSS JOIN (
  VALUES
    ('Lead/Quoted', '#64748b', 0),
    ('Scheduled',   '#3b82f6', 1),
    ('In Progress', '#f59e0b', 2),
    ('Completed',   '#10b981', 3),
    ('Invoiced',    '#8b5cf6', 4),
    ('Paid',        '#0f766e', 5)
) AS d(name, color, position)
WHERE NOT EXISTS (
  SELECT 1 FROM public.pipeline_stages ps WHERE ps.board_id = b.id
);

-- ===========================================================================
-- 4. GIVE EVERY PROJECT THAT WAS ON A BOARD ITS ONE STAGE
-- ===========================================================================
-- A project carrying three of a board's tags used to be drawn in three
-- columns. It gets exactly one now, and the rule is "the furthest along it
-- ever reached": ORDER BY position DESC. A job tagged both Scheduled and
-- Invoiced is an invoiced job, not a scheduled one.
--
-- A project that was on two different boards keeps its place on the older one
-- (ORDER BY b.created_at first), since a project now lives on a single board.
--
-- The team join is not optional, and leaving it out is a real bug that this
-- migration shipped with once: `public.tags` has no team_id and is one shared
-- vocabulary across the whole install, so a tag id listed in one team's board
-- matches `project_tags` rows belonging to every other team that ever used the
-- same tag. Without the join, this statement places other teams' projects on
-- this board. 20260920000000_pipeline_stage_team_scope.sql cleans up the
-- databases where that already happened.

WITH ranked AS (
  SELECT pt.project_id,
         ps.id AS stage_id,
         row_number() OVER (
           PARTITION BY pt.project_id
           ORDER BY b.created_at, b.id, ps.position DESC
         ) AS rn
  FROM public.project_tags pt
  JOIN public.pipeline_stages ps ON ps.legacy_tag_id = pt.tag_id
  JOIN public.project_boards b ON b.id = ps.board_id
  JOIN public.projects proj ON proj.id = pt.project_id
  JOIN public.team_members tm
    ON tm.team_id = b.team_id
   AND tm.user_id = proj.created_by
)
UPDATE public.projects p
   SET pipeline_stage_id = r.stage_id
  FROM ranked r
 WHERE r.project_id = p.id
   AND r.rn = 1
   AND p.pipeline_stage_id IS NULL;

-- ===========================================================================
-- 5. MERGE THE BOARDS THAT WERE ACCIDENTAL DUPLICATES OF EACH OTHER
-- ===========================================================================
-- "Same name, slightly different spelling" in practice means the same letters
-- with different case, spacing or punctuation: "Kitchen Remodels", "kitchen
-- remodels", "Kitchen-Remodels". Those collapse onto the oldest board of the
-- set. Columns that exist on both are merged (the projects move to the
-- keeper's column); columns unique to the duplicate are appended to the right
-- of the keeper, so nothing is lost and nothing needs re-filing by hand.

DO $$
DECLARE
  dup    RECORD;
  stg    RECORD;
  target uuid;
BEGIN
  FOR dup IN
    SELECT b.id AS dup_id, k.keeper_id
    FROM public.project_boards b
    JOIN (
      SELECT team_id,
             lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')) AS norm,
             (array_agg(id ORDER BY created_at, id))[1]           AS keeper_id
      FROM public.project_boards
      GROUP BY 1, 2
      HAVING count(*) > 1
    ) k
      ON k.team_id = b.team_id
     AND k.norm = lower(regexp_replace(b.name, '[^[:alnum:]]', '', 'g'))
    WHERE b.id <> k.keeper_id
  LOOP
    FOR stg IN
      SELECT * FROM public.pipeline_stages WHERE board_id = dup.dup_id ORDER BY position, id
    LOOP
      SELECT ps.id INTO target
      FROM public.pipeline_stages ps
      WHERE ps.board_id = dup.keeper_id
        AND lower(regexp_replace(ps.name, '[^[:alnum:]]', '', 'g'))
          = lower(regexp_replace(stg.name, '[^[:alnum:]]', '', 'g'))
      LIMIT 1;

      IF target IS NULL THEN
        UPDATE public.pipeline_stages
           SET board_id = dup.keeper_id,
               position = COALESCE(
                 (SELECT max(position) + 1 FROM public.pipeline_stages WHERE board_id = dup.keeper_id),
                 0
               )
         WHERE id = stg.id;
      ELSE
        UPDATE public.projects SET pipeline_stage_id = target WHERE pipeline_stage_id = stg.id;
        DELETE FROM public.pipeline_stages WHERE id = stg.id;
      END IF;
    END LOOP;

    DELETE FROM public.project_boards WHERE id = dup.dup_id;
  END LOOP;
END $$;

-- ===========================================================================
-- 6. STOP THE DUPLICATES COMING BACK
-- ===========================================================================
-- The merge above is a one-off. These two indexes are what make it a one-off:
-- a team cannot hold two pipelines whose names differ only in case, spacing or
-- punctuation, and a pipeline cannot hold two columns that read the same.

CREATE UNIQUE INDEX IF NOT EXISTS project_boards_team_normalized_name_key
  ON public.project_boards (team_id, lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')));

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_board_normalized_name_key
  ON public.pipeline_stages (board_id, lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')));

-- ===========================================================================
-- 7. DROP THE SCAFFOLD
-- ===========================================================================
-- Keeping legacy_tag_id would keep a column pointing at a tag, which is the
-- thing this migration exists to end.

ALTER TABLE public.pipeline_stages DROP COLUMN IF EXISTS legacy_tag_id;

COMMENT ON TABLE public.pipeline_stages IS
  'Columns of a pipeline. Owned by project_boards, referenced by projects.pipeline_stage_id. Deliberately not derived from tags: a stage is single-select, a tag is not.';

COMMENT ON COLUMN public.project_boards.tag_ids IS
  'RETIRED. Stages live in public.pipeline_stages now. Kept only so the previously deployed front end keeps loading during the rollout; removed by 20260918000000_project_boards_drop_tag_ids.sql.';
