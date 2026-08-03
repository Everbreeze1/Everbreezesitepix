-- Showcases become a brochure/flyer builder rather than a flat photo grid.
--
-- Original shape (20260728160000_showcases.sql) was: title + tagline + one
-- ungrouped list of captioned photos. Client feedback: a Showcase is a sales
-- piece — "supposed to show off the company and their work… kinda like a
-- brochure or flyer… like rich text but editable" — and the work should be
-- pickable per project, not just photo-by-photo.
--
-- So a showcase now has:
--   * an intro and closing rich-text block (the marketing copy),
--   * an accent colour + contact-block toggle (branding),
--   * ordered SECTIONS, each optionally tied to a project, each with its own
--     heading, rich-text body, and photo set.
--
-- showcase_items gains section_id. Existing rows keep section_id NULL and are
-- read back as one implicit untitled section, so showcases created before this
-- migration keep rendering exactly as they did until they're next edited.
--
-- Apply via the SitePix Supabase SQL editor (or `supabase db push`). Idempotent.

ALTER TABLE public.showcases
  ADD COLUMN IF NOT EXISTS intro_html   text,
  ADD COLUMN IF NOT EXISTS outro_html   text,
  ADD COLUMN IF NOT EXISTS accent_color text,
  ADD COLUMN IF NOT EXISTS show_contact boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.showcase_sections (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  showcase_id uuid NOT NULL REFERENCES public.showcases(id) ON DELETE CASCADE,
  -- Optional provenance: which project this section's work came from. Not a FK
  -- so deleting a project leaves the showcase intact (the copy and photos are
  -- already denormalised into the showcase).
  project_id  uuid,
  title       text,
  body_html   text,
  position    int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS showcase_sections_showcase_id_idx
  ON public.showcase_sections(showcase_id, position);

ALTER TABLE public.showcase_items
  ADD COLUMN IF NOT EXISTS section_id uuid
    REFERENCES public.showcase_sections(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS showcase_items_section_id_idx
  ON public.showcase_items(section_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.showcase_sections TO authenticated;
GRANT ALL ON public.showcase_sections TO service_role;

ALTER TABLE public.showcase_sections ENABLE ROW LEVEL SECURITY;

-- Mirrors the showcase_items policies: any team member may read, but only the
-- showcase's creator (or a team owner/admin) may write.
DROP POLICY IF EXISTS "Team members view showcase sections" ON public.showcase_sections;
CREATE POLICY "Team members view showcase sections" ON public.showcase_sections
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_sections.showcase_id
    )
  );

DROP POLICY IF EXISTS "Manage sections on your own showcases" ON public.showcase_sections;
CREATE POLICY "Manage sections on your own showcases" ON public.showcase_sections
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_sections.showcase_id
        AND (s.created_by = auth.uid() OR tm.role IN ('owner', 'admin'))
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_sections.showcase_id
        AND (s.created_by = auth.uid() OR tm.role IN ('owner', 'admin'))
    )
  );
