-- Photo comments: team chat scoped to a single photo.
-- Visible to any teammate of the project owner (matches tasks/checklists policy pattern).
-- Apply via: supabase db push (or paste into Supabase SQL editor for project ulmgvtuqjlzzadlwtiog)

CREATE TABLE public.photo_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 4000),
  mentions UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX photo_comments_photo_id_idx ON public.photo_comments(photo_id, created_at);
CREATE INDEX photo_comments_project_id_idx ON public.photo_comments(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_comments TO authenticated;
GRANT ALL ON public.photo_comments TO service_role;

ALTER TABLE public.photo_comments ENABLE ROW LEVEL SECURITY;

-- Teammates on the project can view every comment on any of its photos.
CREATE POLICY "Teammates view photo comments" ON public.photo_comments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

-- Teammates can post new comments; author_id must be themselves.
CREATE POLICY "Teammates insert photo comments" ON public.photo_comments
  FOR INSERT TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

-- Only the author can edit or delete their own comment.
CREATE POLICY "Authors update own comments" ON public.photo_comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "Authors delete own comments" ON public.photo_comments
  FOR DELETE TO authenticated USING (author_id = auth.uid());

-- Realtime for live threads
ALTER PUBLICATION supabase_realtime ADD TABLE public.photo_comments;
