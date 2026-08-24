-- Blueprints, layered: component libraries below, bundles above.
--
-- The client's spec, in his words: "Stop letting users build checklists/docs/
-- reports inside the Blueprint screen. Build the pieces once in independent
-- libraries, then let Blueprints just reference and bundle those pieces.
-- Projects then pull a snapshot of the bundle at creation time."
--
-- Most of that shape is already here and has been since 20260718135105:
-- `project_template_items(kind, ref_id)` is the many-to-many join, every
-- component kind already owns its own table, and `applyProjectBlueprintService`
-- already COPIES rather than references, so editing a blueprint afterwards
-- cannot reach back into a project that used it. What this migration adds is
-- the four things the spec asks for that were genuinely missing.
--
-- ---------------------------------------------------------------------------
-- 1. WALKTHROUGH TEMPLATES - the fifth component library
-- ---------------------------------------------------------------------------
-- The spec lists five component types and this repo had four. "Walkthrough
-- template: structured photo/video capture sequence" and, at Layer 3,
-- "Walkthrough templates become the shot list guiding capture for that
-- project."
--
-- So: a `walkthrough_templates` row is a named, ordered shot list, sitting in
-- its own table, editable with no blueprint in sight, attachable to zero, one
-- or many blueprints. That is Layer 1 exactly as written.
--
-- WHY THE INSTANCE LANDS IN `project_workflows` AND NOT A NEW PAIR OF TABLES.
-- A shot list on a project is an ordered run of "take this photo" steps that a
-- crew ticks off. `project_workflow_items` already IS that row: it has
-- `kind IN ('check','photo','note')`, a `photo_id`, `completed_at` and
-- `completed_by`, and the project's Workflows tab already renders and writes
-- it. Building `project_walkthrough_plans` + `_shots` alongside it would have
-- duplicated that table, its RLS, its completion rules and its whole UI to hold
-- the same five columns. The library stays its own object, which is what the
-- spec is actually about; the instance reuses the machinery that already runs.
--
-- `source_kind` on the instance is what keeps the two distinguishable, so a
-- walkthrough reads as a walkthrough on the project instead of quietly becoming
-- a workflow. `walkthrough_template_id` is its provenance pointer, separate
-- from `template_id` because that column carries a foreign key to
-- `workflow_templates` and a walkthrough template id would violate it.
--
-- ---------------------------------------------------------------------------
-- 2. `project_template_items.kind` gains 'walkthrough'
-- ---------------------------------------------------------------------------
-- The CHECK constraint from 20260718135105 lists five kinds. Attaching a
-- walkthrough to a blueprint is rejected until it lists six.
--
-- ---------------------------------------------------------------------------
-- 3. BLUEPRINT CATEGORY - "picks a category/trade (optional, for filtering
--    later)"
-- ---------------------------------------------------------------------------
-- Same nullable-text shape and the same vocabulary as
-- `checklist_templates.category` (20260828000000) and
-- `workflow_templates.category` (20260829000000), so one answer to "we are
-- plumbers" orders every tab on the Templates page the same way.
--
-- `default_for_category` is the spec's "Consider a default Blueprint per
-- project category so most projects can be created in one tap": at most one
-- blueprint per (owner, category) may claim it, enforced by a partial unique
-- index rather than by hoping the UI behaves.
--
-- ---------------------------------------------------------------------------
-- 4. VERSIONING - "editing the master Blueprint later must NOT retroactively
--    alter projects already using it"
-- ---------------------------------------------------------------------------
-- Already true by construction, because the apply is a copy. What was missing
-- is the record of WHICH version was copied, which is the half of the rule that
-- makes it auditable: "Store a blueprint_version or snapshot the component data
-- onto the project-level instance."
--
-- `project_templates.version` counts edits to the bundle, bumped by a trigger
-- on the join table so attaching or detaching a component is what moves it, not
-- a rename. `project_blueprint_applications.blueprint_version` stamps the
-- version each project actually received.
--
-- ---------------------------------------------------------------------------
-- Idempotent throughout: IF NOT EXISTS, DROP POLICY IF EXISTS, and constraint
-- swaps guarded by a catalog lookup. Safe to re-run.
-- Apply in the Everlumen Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

-- ===========================================================================
-- PART 1 - walkthrough_templates
-- ===========================================================================
-- Ownership mirrors `workflow_templates` (20260616050717) rather than the
-- team-scoped `document_templates`: per-user, `created_by` NOT NULL, four
-- single-role policies. That is deliberate. These two libraries sit next to
-- each other on the Templates page and are picked from the same dropdown, so
-- two different answers to "who can see this one" is the sort of drift that
-- shows up later as a blueprint whose sections are visible to its author only.

CREATE TABLE IF NOT EXISTS public.walkthrough_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  -- A trade from apps/web/src/lib/template-categories.ts. Null means "not
  -- filed", which the page groups under General.
  category    text,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS walkthrough_templates_created_by_idx
  ON public.walkthrough_templates(created_by);

-- REVOKE BEFORE GRANT, and this order matters.
--
-- Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
-- TO anon`, so a newly created public table is readable by the publishable key -
-- which ships in the browser bundle - from the instant it exists. That is
-- exactly how `walkthroughs`, `walkthrough_photos` and `team_invites` leaked
-- before 20260811000000 shut them. RLS alone would not save this table either:
-- an anon session has no `auth.uid()`, so the policies below deny it, but the
-- table-level grant is what a future policy change would be measured against.
-- `tests/invariants.test.ts` fails the build without these two lines.
REVOKE ALL ON public.walkthrough_templates FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthrough_templates TO authenticated;
GRANT ALL ON public.walkthrough_templates TO service_role;

ALTER TABLE public.walkthrough_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own walkthrough templates" ON public.walkthrough_templates;
CREATE POLICY "Users view own walkthrough templates" ON public.walkthrough_templates
  FOR SELECT TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users insert own walkthrough templates" ON public.walkthrough_templates;
CREATE POLICY "Users insert own walkthrough templates" ON public.walkthrough_templates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users update own walkthrough templates" ON public.walkthrough_templates;
CREATE POLICY "Users update own walkthrough templates" ON public.walkthrough_templates
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users delete own walkthrough templates" ON public.walkthrough_templates;
CREATE POLICY "Users delete own walkthrough templates" ON public.walkthrough_templates
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- ===========================================================================
-- PART 2 - walkthrough_template_shots
-- ===========================================================================
-- One row per shot. `capture` is what the crew is asked to produce:
--   photo - a still, the default and the overwhelming majority
--   video - a clip, for anything a still cannot show (running water, a fault
--           that only appears under load)
--   note  - no capture at all, an instruction or a reading to write down
--
-- These three map one-for-one onto `project_workflow_items.kind`
-- ('photo','note','check'), which is what lets the apply reuse that table. The
-- mapping is spelled out in applyProjectBlueprintService rather than left to
-- coincidence.

CREATE TABLE IF NOT EXISTS public.walkthrough_template_shots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.walkthrough_templates(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  label       text NOT NULL,
  -- What the shot is for, shown under the label while the crew captures it.
  description text,
  capture     text NOT NULL DEFAULT 'photo'
                CHECK (capture IN ('photo', 'video', 'note')),
  required    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS walkthrough_template_shots_template_idx
  ON public.walkthrough_template_shots(template_id, position);

-- Same rule, same reason as the parent table above.
REVOKE ALL ON public.walkthrough_template_shots FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthrough_template_shots TO authenticated;
GRANT ALL ON public.walkthrough_template_shots TO service_role;

ALTER TABLE public.walkthrough_template_shots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View own walkthrough shots" ON public.walkthrough_template_shots;
CREATE POLICY "View own walkthrough shots" ON public.walkthrough_template_shots
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.walkthrough_templates t
    WHERE t.id = walkthrough_template_shots.template_id AND t.created_by = auth.uid()
  ));

DROP POLICY IF EXISTS "Insert own walkthrough shots" ON public.walkthrough_template_shots;
CREATE POLICY "Insert own walkthrough shots" ON public.walkthrough_template_shots
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.walkthrough_templates t
    WHERE t.id = walkthrough_template_shots.template_id AND t.created_by = auth.uid()
  ));

DROP POLICY IF EXISTS "Update own walkthrough shots" ON public.walkthrough_template_shots;
CREATE POLICY "Update own walkthrough shots" ON public.walkthrough_template_shots
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.walkthrough_templates t
    WHERE t.id = walkthrough_template_shots.template_id AND t.created_by = auth.uid()
  ));

DROP POLICY IF EXISTS "Delete own walkthrough shots" ON public.walkthrough_template_shots;
CREATE POLICY "Delete own walkthrough shots" ON public.walkthrough_template_shots
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.walkthrough_templates t
    WHERE t.id = walkthrough_template_shots.template_id AND t.created_by = auth.uid()
  ));

-- updated_at, same shared trigger function the other library tables use.
DROP TRIGGER IF EXISTS trg_walkthrough_templates_updated_at ON public.walkthrough_templates;
CREATE TRIGGER trg_walkthrough_templates_updated_at
  BEFORE UPDATE ON public.walkthrough_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_template_kind_updated_at();

-- ===========================================================================
-- PART 3 - the project-side instance keeps its identity
-- ===========================================================================
-- Without `source_kind` an applied walkthrough is indistinguishable from an
-- applied workflow the moment it lands, and the project would call a shot list
-- a workflow forever after. NOT NULL DEFAULT is metadata-only on PG11+, so no
-- rewrite and no long lock: every existing row is a workflow and says so.

ALTER TABLE public.project_workflows
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'workflow';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_workflows_source_kind_check'
  ) THEN
    ALTER TABLE public.project_workflows
      ADD CONSTRAINT project_workflows_source_kind_check
      CHECK (source_kind IN ('workflow', 'walkthrough'));
  END IF;
END $$;

-- Provenance. `template_id` cannot carry this: it has a foreign key to
-- `workflow_templates`, so writing a walkthrough template's id there is
-- rejected outright. ON DELETE SET NULL matches `template_id` - deleting the
-- library row must not delete the run a crew already worked through.
ALTER TABLE public.project_workflows
  ADD COLUMN IF NOT EXISTS walkthrough_template_id uuid
    REFERENCES public.walkthrough_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_workflows_walkthrough_template_idx
  ON public.project_workflows(walkthrough_template_id);

-- ===========================================================================
-- PART 4 - blueprints may now contain a walkthrough
-- ===========================================================================
-- The CHECK from 20260718135105 is dropped and rewritten rather than added to,
-- because a CHECK constraint has no ALTER. Named explicitly so the swap is
-- idempotent and so a future kind is a two-line change here.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_template_items_kind_check'
  ) THEN
    ALTER TABLE public.project_template_items
      DROP CONSTRAINT project_template_items_kind_check;
  END IF;

  ALTER TABLE public.project_template_items
    ADD CONSTRAINT project_template_items_kind_check
    CHECK (kind IN ('checklist', 'document', 'report', 'label_set', 'workflow', 'walkthrough'));
END $$;

-- ===========================================================================
-- PART 5 - blueprint metadata: trade, and the default for that trade
-- ===========================================================================

ALTER TABLE public.project_templates
  ADD COLUMN IF NOT EXISTS category text;

-- "Consider a default Blueprint per project category so most projects can be
-- created in one tap." The new-project screen preselects this one.
ALTER TABLE public.project_templates
  ADD COLUMN IF NOT EXISTS default_for_category boolean NOT NULL DEFAULT false;

-- At most one default per (owner, trade). A partial unique index rather than a
-- UI convention, because "two blueprints both claim to be the default" is a
-- state that has no correct rendering and would be reached by two people
-- ticking the box in different tabs.
--
-- Keyed on created_by, not team_id: `project_templates.team_id` is nullable and
-- IS null for every blueprint made by a user without a team, so a team-keyed
-- index would collapse all of those solo users into one shared slot.
CREATE UNIQUE INDEX IF NOT EXISTS project_templates_one_default_per_category
  ON public.project_templates(created_by, category)
  WHERE default_for_category AND category IS NOT NULL AND NOT archived;

CREATE INDEX IF NOT EXISTS project_templates_category_idx
  ON public.project_templates(category)
  WHERE NOT archived;

-- ===========================================================================
-- PART 6 - versioning
-- ===========================================================================
-- The version a project received, so "which shape of this blueprint made this
-- project" is answerable after the blueprint has moved on. The instances are
-- already copies, so this is the audit trail, not the isolation mechanism.

ALTER TABLE public.project_templates
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE public.project_blueprint_applications
  ADD COLUMN IF NOT EXISTS blueprint_version integer;

-- Bumped when the BUNDLE changes, which is the only change that could alter
-- what a project would receive. A rename or a new description does not move it:
-- the version exists to answer "would applying this today give me something
-- different", and a different name would not.
CREATE OR REPLACE FUNCTION public.bump_project_template_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
BEGIN
  target := COALESCE(NEW.project_template_id, OLD.project_template_id);
  UPDATE public.project_templates
     SET version = version + 1
   WHERE id = target;
  RETURN NULL; -- AFTER trigger, the return value is discarded
END $$;

-- SECURITY DEFINER because the trigger writes to `project_templates`, and a
-- teammate with write access to the join table may not have UPDATE on the
-- parent row. Without it, attaching a section would fail RLS on the bump rather
-- than on the insert the user actually asked for.
REVOKE ALL ON FUNCTION public.bump_project_template_version() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_project_template_items_version ON public.project_template_items;
CREATE TRIGGER trg_project_template_items_version
  AFTER INSERT OR DELETE ON public.project_template_items
  FOR EACH ROW EXECUTE FUNCTION public.bump_project_template_version();

-- The legacy checklist join table is still readable and still applied, so a
-- blueprint that has one can still change shape through it.
DROP TRIGGER IF EXISTS trg_project_template_checklists_version ON public.project_template_checklists;
CREATE TRIGGER trg_project_template_checklists_version
  AFTER INSERT OR DELETE ON public.project_template_checklists
  FOR EACH ROW EXECUTE FUNCTION public.bump_project_template_version();

-- === VERIFY ================================================================
--
-- The two new tables and their columns.
--
-- SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name IN ('walkthrough_templates', 'walkthrough_template_shots')
--  ORDER BY table_name, ordinal_position;
--
-- RLS on, four policies each.
--
-- SELECT tablename, count(*) AS policies
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('walkthrough_templates', 'walkthrough_template_shots')
--  GROUP BY 1;
--
-- Six kinds, not five. Expect the CHECK to name 'walkthrough'.
--
-- SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname = 'project_template_items_kind_check';
--
-- New blueprint columns. Expect category (nullable), default_for_category
-- (not null, false), version (not null, 1).
--
-- SELECT column_name, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'project_templates'
--    AND column_name IN ('category', 'default_for_category', 'version');
--
-- The instance discriminator. Expect every existing row to read 'workflow'.
--
-- SELECT source_kind, count(*) FROM public.project_workflows GROUP BY 1;
--
-- The version trigger actually fires. Attach a section to any blueprint and
-- expect `version` to be one higher than it was.
--
-- SELECT id, name, version FROM public.project_templates ORDER BY updated_at DESC LIMIT 5;
--
-- One default per trade is enforced, not hoped for. This should FAIL with a
-- unique violation on the second statement:
--
-- -- UPDATE public.project_templates SET category = 'Plumbing', default_for_category = true
-- --  WHERE id = '<blueprint-a>';
-- -- UPDATE public.project_templates SET category = 'Plumbing', default_for_category = true
-- --  WHERE id = '<blueprint-b>';   -- expect: duplicate key value violates unique constraint
