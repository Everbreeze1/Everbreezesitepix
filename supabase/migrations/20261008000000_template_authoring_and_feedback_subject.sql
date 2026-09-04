-- Template/checklist/workflow authoring permissions and feedback subjects.
--
-- Client rule:
--   * reusable template authoring and project checklist/workflow structure are
--     available only to Owner, Admin and Manager roles;
--   * the account must be on an active Pro or Team plan;
--   * crew may still run records after an author creates them;
--   * bug reports carry a short subject for triage.
--
-- The browser writes these tables directly through Supabase, so React gating is
-- only presentation. The triggers below are the enforcement boundary.
-- Service-role writes have auth.uid() = NULL and intentionally bypass actor
-- checks so blueprint application and other trusted server jobs keep working.

SET lock_timeout = '5s';

-- ===========================================================================
-- 1. Feedback subject
-- ===========================================================================

ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS subject text;

ALTER TABLE public.issue_reports
  DROP CONSTRAINT IF EXISTS issue_reports_subject_length_check;
ALTER TABLE public.issue_reports
  ADD CONSTRAINT issue_reports_subject_length_check
  CHECK (subject IS NULL OR char_length(subject) <= 160);

-- ===========================================================================
-- 2. Shared authoring checks
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.can_author_templates(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = _user_id
      AND tm.role IN ('owner', 'admin', 'manager')
      AND (
        t.is_internal
        OR (
          t.plan IN ('pro', 'team')
          AND t.subscription_status IN ('active', 'trialing', 'past_due')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_author_templates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_author_templates(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_account_template(
  _user_id uuid,
  _team_id uuid,
  _created_by uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_author_templates(_user_id)
     AND (
       _created_by = _user_id
       OR (_team_id IS NOT NULL AND _team_id = public.user_team_id(_user_id))
     );
$$;

REVOKE ALL ON FUNCTION public.can_manage_account_template(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_account_template(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_project_template(_user_id uuid, _template_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_templates pt
    WHERE pt.id = _template_id
      AND public.can_manage_account_template(_user_id, pt.team_id, pt.created_by)
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_project_template(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_project_template(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_author_project_structure(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_author_templates(_user_id)
     AND EXISTS (
       SELECT 1
       FROM public.projects p
       WHERE p.id = _project_id
         AND public.are_teammates(_user_id, p.created_by)
     );
$$;

REVOKE ALL ON FUNCTION public.can_author_project_structure(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_author_project_structure(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_author_checklist(_user_id uuid, _checklist_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_checklists c
    WHERE c.id = _checklist_id
      AND public.can_author_project_structure(_user_id, c.project_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_author_workflow(_user_id uuid, _workflow_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_workflows w
    WHERE w.id = _workflow_id
      AND public.can_author_project_structure(_user_id, w.project_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_author_workflow_phase(_user_id uuid, _phase_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_workflow_phases ph
    WHERE ph.id = _phase_id
      AND public.can_author_workflow(_user_id, ph.workflow_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_author_checklist(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_author_workflow(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_author_workflow_phase(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_author_checklist(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_author_workflow(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_author_workflow_phase(uuid, uuid) TO authenticated;

-- ===========================================================================
-- 3. Reusable template writes
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enforce_template_authoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_author_templates(auth.uid()) THEN
    RAISE EXCEPTION 'Template authoring requires an Owner, Admin, or Manager on a Pro or Team plan.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklist_templates_authoring_guard ON public.checklist_templates;
CREATE TRIGGER checklist_templates_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS checklist_template_items_authoring_guard ON public.checklist_template_items;
CREATE TRIGGER checklist_template_items_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.checklist_template_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS workflow_templates_authoring_guard ON public.workflow_templates;
CREATE TRIGGER workflow_templates_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.workflow_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS workflow_template_phases_authoring_guard ON public.workflow_template_phases;
CREATE TRIGGER workflow_template_phases_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.workflow_template_phases
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS workflow_template_items_authoring_guard ON public.workflow_template_items;
CREATE TRIGGER workflow_template_items_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.workflow_template_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS project_templates_authoring_guard ON public.project_templates;
CREATE TRIGGER project_templates_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS project_template_checklists_authoring_guard ON public.project_template_checklists;
CREATE TRIGGER project_template_checklists_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_template_checklists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS project_template_items_authoring_guard ON public.project_template_items;
CREATE TRIGGER project_template_items_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_template_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS report_templates_authoring_guard ON public.report_templates;
CREATE TRIGGER report_templates_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS document_templates_authoring_guard ON public.document_templates;
CREATE TRIGGER document_templates_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS walkthrough_templates_authoring_guard ON public.walkthrough_templates;
CREATE TRIGGER walkthrough_templates_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.walkthrough_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

DROP TRIGGER IF EXISTS walkthrough_template_shots_authoring_guard ON public.walkthrough_template_shots;
CREATE TRIGGER walkthrough_template_shots_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.walkthrough_template_shots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_authoring();

-- Managers need an RLS path to edit team-scoped templates created by another
-- authorized teammate. The trigger above still blocks Starter and crew roles.
DROP POLICY IF EXISTS "Template authors manage account project templates" ON public.project_templates;
CREATE POLICY "Template authors manage account project templates"
  ON public.project_templates FOR ALL TO authenticated
  USING (public.can_manage_account_template(auth.uid(), team_id, created_by))
  WITH CHECK (public.can_manage_account_template(auth.uid(), team_id, created_by));

DROP POLICY IF EXISTS "Template authors manage account report templates" ON public.report_templates;
CREATE POLICY "Template authors manage account report templates"
  ON public.report_templates FOR ALL TO authenticated
  USING (public.can_manage_account_template(auth.uid(), team_id, created_by))
  WITH CHECK (public.can_manage_account_template(auth.uid(), team_id, created_by));

DROP POLICY IF EXISTS "Template authors manage account document templates" ON public.document_templates;
CREATE POLICY "Template authors manage account document templates"
  ON public.document_templates FOR ALL TO authenticated
  USING (public.can_manage_account_template(auth.uid(), team_id, created_by))
  WITH CHECK (public.can_manage_account_template(auth.uid(), team_id, created_by));

DROP POLICY IF EXISTS "Template authors manage project template checklists" ON public.project_template_checklists;
CREATE POLICY "Template authors manage project template checklists"
  ON public.project_template_checklists FOR ALL TO authenticated
  USING (public.can_manage_project_template(auth.uid(), project_template_id))
  WITH CHECK (public.can_manage_project_template(auth.uid(), project_template_id));

DROP POLICY IF EXISTS "Template authors manage project template items" ON public.project_template_items;
CREATE POLICY "Template authors manage project template items"
  ON public.project_template_items FOR ALL TO authenticated
  USING (public.can_manage_project_template(auth.uid(), project_template_id))
  WITH CHECK (public.can_manage_project_template(auth.uid(), project_template_id));

-- ===========================================================================
-- 4. Project checklist structure
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enforce_project_checklist_authoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _needs_author boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    _needs_author :=
      NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.template_id IS DISTINCT FROM OLD.template_id
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.created_by IS DISTINCT FROM OLD.created_by;
    IF NOT _needs_author THEN RETURN NEW; END IF;

    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       AND NOT public.can_author_project_structure(auth.uid(), OLD.project_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit checklist structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NOT public.can_author_project_structure(
    auth.uid(), CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END
  ) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can create or edit checklists.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_checklists_authoring_guard ON public.project_checklists;
CREATE TRIGGER project_checklists_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_checklists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_checklist_authoring();

CREATE OR REPLACE FUNCTION public.enforce_project_checklist_item_authoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      NEW.checklist_id IS DISTINCT FROM OLD.checklist_id
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.label IS DISTINCT FROM OLD.label
      OR NEW.required IS DISTINCT FROM OLD.required
      OR NEW.item_type IS DISTINCT FROM OLD.item_type
      OR NEW.description IS DISTINCT FROM OLD.description
    ) THEN
      RETURN NEW;
    END IF;

    IF NEW.checklist_id IS DISTINCT FROM OLD.checklist_id
       AND NOT public.can_author_checklist(auth.uid(), OLD.checklist_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit checklist structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  _target := CASE WHEN TG_OP = 'DELETE' THEN OLD.checklist_id ELSE NEW.checklist_id END;
  IF NOT public.can_author_checklist(auth.uid(), _target) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit checklist structure.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_checklist_items_authoring_guard ON public.project_checklist_items;
CREATE TRIGGER project_checklist_items_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_checklist_item_authoring();

-- ===========================================================================
-- 5. Project workflow structure
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enforce_project_workflow_authoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.template_id IS DISTINCT FROM OLD.template_id
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
      OR NEW.walkthrough_template_id IS DISTINCT FROM OLD.walkthrough_template_id
    ) THEN
      RETURN NEW;
    END IF;

    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       AND NOT public.can_author_project_structure(auth.uid(), OLD.project_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NOT public.can_author_project_structure(
    auth.uid(), CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END
  ) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can create or edit workflows.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflows_authoring_guard ON public.project_workflows;
CREATE TRIGGER project_workflows_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_workflow_authoring();

CREATE OR REPLACE FUNCTION public.enforce_project_workflow_phase_authoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.requires_signoff IS DISTINCT FROM OLD.requires_signoff
    ) THEN
      RETURN NEW;
    END IF;

    IF NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
       AND NOT public.can_author_workflow(auth.uid(), OLD.workflow_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  _target := CASE WHEN TG_OP = 'DELETE' THEN OLD.workflow_id ELSE NEW.workflow_id END;
  IF NOT public.can_author_workflow(auth.uid(), _target) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_phases_authoring_guard ON public.project_workflow_phases;
CREATE TRIGGER project_workflow_phases_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_workflow_phases
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_workflow_phase_authoring();

CREATE OR REPLACE FUNCTION public.enforce_project_workflow_item_authoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      NEW.phase_id IS DISTINCT FROM OLD.phase_id
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.label IS DISTINCT FROM OLD.label
      OR NEW.required IS DISTINCT FROM OLD.required
    ) THEN
      RETURN NEW;
    END IF;

    IF NEW.phase_id IS DISTINCT FROM OLD.phase_id
       AND NOT public.can_author_workflow_phase(auth.uid(), OLD.phase_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  _target := CASE WHEN TG_OP = 'DELETE' THEN OLD.phase_id ELSE NEW.phase_id END;
  IF NOT public.can_author_workflow_phase(auth.uid(), _target) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_items_authoring_guard ON public.project_workflow_items;
CREATE TRIGGER project_workflow_items_authoring_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_workflow_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_workflow_item_authoring();

-- Pro/Team Managers need explicit INSERT/DELETE paths for workflow rows because
-- the historical policies were owner-only and the old INSERT gate was Team-only.
DROP POLICY IF EXISTS "Template authors insert project workflows" ON public.project_workflows;
CREATE POLICY "Template authors insert project workflows"
  ON public.project_workflows FOR INSERT TO authenticated
  WITH CHECK (public.can_author_project_structure(auth.uid(), project_id));

DROP POLICY IF EXISTS "Template authors delete project workflows" ON public.project_workflows;
CREATE POLICY "Template authors delete project workflows"
  ON public.project_workflows FOR DELETE TO authenticated
  USING (public.can_author_project_structure(auth.uid(), project_id));

DROP POLICY IF EXISTS "Template authors insert workflow phases" ON public.project_workflow_phases;
CREATE POLICY "Template authors insert workflow phases"
  ON public.project_workflow_phases FOR INSERT TO authenticated
  WITH CHECK (public.can_author_workflow(auth.uid(), workflow_id));

DROP POLICY IF EXISTS "Template authors delete workflow phases" ON public.project_workflow_phases;
CREATE POLICY "Template authors delete workflow phases"
  ON public.project_workflow_phases FOR DELETE TO authenticated
  USING (public.can_author_workflow(auth.uid(), workflow_id));

DROP POLICY IF EXISTS "Template authors insert workflow items" ON public.project_workflow_items;
CREATE POLICY "Template authors insert workflow items"
  ON public.project_workflow_items FOR INSERT TO authenticated
  WITH CHECK (public.can_author_workflow_phase(auth.uid(), phase_id));

DROP POLICY IF EXISTS "Template authors delete workflow items" ON public.project_workflow_items;
CREATE POLICY "Template authors delete workflow items"
  ON public.project_workflow_items FOR DELETE TO authenticated
  USING (public.can_author_workflow_phase(auth.uid(), phase_id));

-- ===========================================================================
-- 6. Verification notes
-- ===========================================================================
-- Expected authoring matrix after this migration:
--   Starter, any role             -> denied
--   Pro/Team, Standard/Restricted -> denied
--   Pro/Team, Owner/Admin/Manager -> allowed
--   service_role                  -> allowed
--
-- Crew execution is intentionally untouched. Updates limited to response,
-- completion, notes, evidence and sign-off fields continue through the existing
-- teammate/assignment policies and do not trip the structural-change guards.
