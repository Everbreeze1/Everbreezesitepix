-- Checklists: attach photos to individual checklist items
-- Apply via: supabase db push (or paste into Supabase SQL editor for project ulmgvtuqjlzzadlwtiog)

CREATE TABLE public.checklist_item_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.project_checklist_items(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, photo_id)
);
CREATE INDEX checklist_item_photos_item_id_idx ON public.checklist_item_photos(item_id);
CREATE INDEX checklist_item_photos_photo_id_idx ON public.checklist_item_photos(photo_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_item_photos TO authenticated;
GRANT ALL ON public.checklist_item_photos TO service_role;

ALTER TABLE public.checklist_item_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view checklist photos on own projects" ON public.checklist_item_photos
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_checklist_items i
      JOIN public.project_checklists c ON c.id = i.checklist_id
      JOIN public.projects p ON p.id = c.project_id
      WHERE i.id = item_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "Users insert checklist photos on own projects" ON public.checklist_item_photos
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_checklist_items i
      JOIN public.project_checklists c ON c.id = i.checklist_id
      JOIN public.projects p ON p.id = c.project_id
      WHERE i.id = item_id AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "Users delete checklist photos on own projects" ON public.checklist_item_photos
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_checklist_items i
      JOIN public.project_checklists c ON c.id = i.checklist_id
      JOIN public.projects p ON p.id = c.project_id
      WHERE i.id = item_id AND p.created_by = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.checklist_item_photos;
