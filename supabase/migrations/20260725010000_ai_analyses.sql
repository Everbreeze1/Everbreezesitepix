-- ai_analyses does not exist on the live database at all, even though
-- apps/api/src/domains/ai/service.ts has depended on it since analyzePhotoService
-- was written — every "Analyze with AI" request currently fails at the first
-- INSERT. This restores it, mirroring the teammate-visibility pattern used for
-- photos in 20260612191404_teams.sql (are_teammates() joined through the photo's
-- project). Apply manually in the Supabase SQL editor (or `supabase db push`).
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.ai_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  ocr_text TEXT,
  labels TEXT[] NOT NULL DEFAULT '{}',
  defects JSONB NOT NULL DEFAULT '[]',
  report_text TEXT,
  recommendations TEXT[] NOT NULL DEFAULT '{}',
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_analyses_photo_id_idx ON public.ai_analyses(photo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_analyses_created_by_idx ON public.ai_analyses(created_by, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_analyses TO authenticated;
GRANT ALL ON public.ai_analyses TO service_role;

ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teammates view team ai_analyses" ON public.ai_analyses;
CREATE POLICY "Teammates view team ai_analyses" ON public.ai_analyses
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.photos ph
      JOIN public.projects p ON p.id = ph.project_id
      WHERE ph.id = photo_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

DROP POLICY IF EXISTS "Users insert own ai_analyses" ON public.ai_analyses;
CREATE POLICY "Users insert own ai_analyses" ON public.ai_analyses
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Users update own ai_analyses" ON public.ai_analyses;
CREATE POLICY "Users update own ai_analyses" ON public.ai_analyses
  FOR UPDATE TO authenticated USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users delete own ai_analyses" ON public.ai_analyses;
CREATE POLICY "Users delete own ai_analyses" ON public.ai_analyses
  FOR DELETE TO authenticated USING (created_by = auth.uid());
