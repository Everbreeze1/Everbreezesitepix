-- Workflows and report templates get a trade, finishing what 20260828000000
-- started for checklists.
--
-- The Templates page has seven tabs and the trade only led on two of them.
-- A company that answered "we are plumbers" in the setup wizard saw Plumbing
-- first under Documents and Checklists, then clicked Workflows or Reports and
-- got the old flat list back. A personalisation that holds on some tabs and
-- not others reads as broken, not as partial.
--
-- Two tables, one nullable column each, for the same reason and with the same
-- meaning as the checklist column: null is "not filed", which is what every
-- existing row honestly is, and both pages group those under General rather
-- than hiding them.
--
-- The two tables are NOT the same shape underneath, and the difference matters
-- for where the built-in library lives:
--
--   * `workflow_templates` is per-user - `created_by` NOT NULL, every policy
--     `auth.uid() = created_by`. Same as checklists, so there is no ownerless
--     row to seed and the starters stay in STARTER_WORKFLOWS in
--     apps/web/src/features/settings/pages/WorkflowTemplatesPage.tsx.
--   * `report_templates` is team-scoped and readable by teammates, but its
--     built-in library was already deliberately kept in code as
--     packages/shared/src/report-starters.ts - see the header there. This
--     column is for the templates a team writes itself, which is what the
--     table actually holds.
--
-- Both columns take strings from apps/web/src/lib/template-categories.ts, the
-- same vocabulary as documents and checklists, so `makeCategoryRank` can order
-- every tab from the one answer the company gave.
--
-- Additive and nullable, so every existing row stays valid and no current
-- query changes meaning. Both columns inherit their table's existing RLS, so
-- there is nothing to grant.
--
-- Idempotent - ADD COLUMN IF NOT EXISTS. Safe to re-run.
-- Apply manually in the Supabase SQL editor (or `supabase db push`).

ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS category TEXT;

-- === VERIFY ================================================================
-- Expect two rows, both nullable.
--
-- SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name IN ('workflow_templates', 'report_templates')
--    AND column_name = 'category'
--  ORDER BY table_name;
--
-- How teams have filed them, once the tabs have been used.
--
-- SELECT 'workflow' AS kind, coalesce(category, 'General') AS trade, count(*)
--   FROM public.workflow_templates WHERE archived = false GROUP BY 1, 2
-- UNION ALL
-- SELECT 'report', coalesce(category, 'General'), count(*)
--   FROM public.report_templates WHERE archived = false GROUP BY 1, 2
--  ORDER BY 1, 3 DESC;
