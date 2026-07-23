-- Checklist templates v2: item types, helper text, response values
-- Idempotent. Safe to re-run.

-- 1) Template items: add type + helper text
ALTER TABLE public.checklist_template_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'checkbox',
  ADD COLUMN IF NOT EXISTS description text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_template_items_item_type_check'
  ) THEN
    ALTER TABLE public.checklist_template_items
      ADD CONSTRAINT checklist_template_items_item_type_check
      CHECK (item_type IN ('checkbox','rating','text','pass_fail','numeric','yes_no'));
  END IF;
END $$;

-- 2) Project (instance) checklist items: same fields + a response value
ALTER TABLE public.project_checklist_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'checkbox',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS response_value jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_checklist_items_item_type_check'
  ) THEN
    ALTER TABLE public.project_checklist_items
      ADD CONSTRAINT project_checklist_items_item_type_check
      CHECK (item_type IN ('checkbox','rating','text','pass_fail','numeric','yes_no'));
  END IF;
END $$;

-- 3) Optional archived flag for templates (if not present)
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
