-- Run this in the Everlumen Supabase SQL editor.
-- The Lovable Cloud migration tool targets a different Postgres project.

-- =========================
-- PROJECT DOCUMENTS
-- =========================
CREATE TABLE IF NOT EXISTS public.project_documents (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploaded_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name    text NOT NULL,
  mime_type    text,
  size_bytes   bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_documents_project ON public.project_documents(project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_documents TO authenticated;
GRANT ALL ON public.project_documents TO service_role;

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project owners manage documents" ON public.project_documents
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_documents.project_id AND p.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_documents.project_id AND p.created_by = auth.uid()));

-- =========================
-- STORAGE BUCKET (private)
-- =========================
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-documents', 'site-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Files are stored as: {user_id}/{project_id}/{filename}
CREATE POLICY "Users view own site documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'site-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own site documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own site documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'site-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own site documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
