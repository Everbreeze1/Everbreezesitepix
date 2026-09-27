-- Give Restricted members back the two tables 20261009030000 added.
--
-- `issues` and `defect_taxonomies` are guarded by `are_teammates`, which
-- 20260911000000 narrowed so a Restricted member no longer matches it. Every
-- other teammate-guarded table got a `member_can_reach_project` policy in
-- 20260912000000; these two arrived later and did not, so a Restricted
-- technician saw no flagged issues on the very jobs they are assigned to.
--
-- Mirrors the teammate policies: read, plus the confirm/dismiss update. No
-- INSERT (issues are AI- or service-written) and no DELETE (Restricted gets no
-- destructive actions).

DROP POLICY IF EXISTS "Restricted members view assigned issues" ON public.issues;
CREATE POLICY "Restricted members view assigned issues" ON public.issues
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members resolve assigned issues" ON public.issues;
CREATE POLICY "Restricted members resolve assigned issues" ON public.issues
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id))
  WITH CHECK (status IN ('open', 'confirmed', 'dismissed'));

-- Team-wide rows (project_id IS NULL) are already readable by everyone through
-- the teammate policy; this adds the project-scoped ones.
DROP POLICY IF EXISTS "Restricted members view assigned defect taxonomy" ON public.defect_taxonomies;
CREATE POLICY "Restricted members view assigned defect taxonomy" ON public.defect_taxonomies
  FOR SELECT TO authenticated
  USING (project_id IS NOT NULL AND public.member_can_reach_project(auth.uid(), project_id));
