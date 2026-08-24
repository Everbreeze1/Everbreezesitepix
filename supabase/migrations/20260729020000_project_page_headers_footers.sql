-- Per-page running header/footer (rendered on every PDF page, like a Word
-- header/footer) - see docs/documents-feature-plan.md. Apply via the Everlumen
-- Supabase SQL editor (or `supabase db push`). Idempotent.

ALTER TABLE public.project_pages
  ADD COLUMN IF NOT EXISTS header_html text,
  ADD COLUMN IF NOT EXISTS footer_html text;
