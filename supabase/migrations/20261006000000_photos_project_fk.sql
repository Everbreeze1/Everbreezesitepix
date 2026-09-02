-- Photos, videos and portfolio sections point at a project by id, and nothing
-- has ever required that project to exist.
--
-- WHAT IS WRONG
--
-- `photos.project_id` carries no foreign key. `photos_uploaded_by_fkey` is the
-- only one on the table. Fifteen other tables holding a `project_id` do have
-- one - `photo_comments`, `project_documents`, `project_checklists`,
-- `project_assignments`, `notifications` and the rest - so this is an
-- inconsistency rather than a decision.
--
-- The effect is visible in the app today. Eight photo rows name three projects
-- that no longer exist, and the phone draws them on the Home screen and in the
-- Gallery under the fallback label "A project", as tiles reading "Photo
-- unavailable". Nothing that walks from a project to its photos will ever reach
-- them again.
--
-- `videos` and `showcase_sections` have the same gap and, today, no orphans.
-- They are included so the three stop drifting from the other fifteen.
--
-- WHY `NOT VALID`
--
-- A plain ADD CONSTRAINT checks every existing row and fails while one orphan
-- remains, so applying it would mean deleting eight rows of somebody's data
-- first, as one irreversible step bundled into a schema change.
--
-- `NOT VALID` splits that in two. Postgres enforces the constraint on every
-- INSERT and UPDATE from the moment this runs - so no NEW orphan can be
-- created, which is the actual hole - and simply does not check the rows
-- already there. The clean-up then becomes a separate decision that can be
-- taken later, by someone who has looked at what would go, with no schema work
-- attached to it.
--
-- This file is therefore safe to apply as it stands.

-- === THE CONSTRAINTS =========================================================
-- ON DELETE CASCADE, matching `photo_comments` and `project_documents`: a
-- project's photographs are part of the project. The app's own delete path
-- (`purge-trash`) already removes them explicitly before the project goes; this
-- is the floor under that, not a replacement for it.

ALTER TABLE public.photos
  ADD CONSTRAINT photos_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.videos
  ADD CONSTRAINT videos_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
  NOT VALID;

-- Nullable here: a portfolio section need not be about a project.
ALTER TABLE public.showcase_sections
  ADD CONSTRAINT showcase_sections_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL
  NOT VALID;

-- === LATER, AND SEPARATELY ===================================================
-- The eight rows above are still there, still unreachable. To finish the job:
--
-- 1. Look at what would go. On this database it is eight rows captioned "g1",
--    "g2" and "Verify photo 1..3", all uploaded on 17 August, across three
--    projects that no longer exist. Confirm that is still what it is - an
--    orphan created by a customer losing a project is a different conversation,
--    and their storage objects would want lifting out first.
--
--    SELECT ph.id, ph.caption, ph.project_id, ph.created_at
--    FROM public.photos ph
--    LEFT JOIN public.projects p ON p.id = ph.project_id
--    WHERE p.id IS NULL
--    ORDER BY ph.created_at;
--
-- 2. Remove them. THIS DELETES ROWS.
--
--    DELETE FROM public.photos ph
--    WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = ph.project_id);
--
-- 3. Promote the constraint, which now checks what is left and will refuse if
--    anything was missed.
--
--    ALTER TABLE public.photos VALIDATE CONSTRAINT photos_project_id_fkey;
--    ALTER TABLE public.videos VALIDATE CONSTRAINT videos_project_id_fkey;
--    ALTER TABLE public.showcase_sections
--      VALIDATE CONSTRAINT showcase_sections_project_id_fkey;

-- === CHECKING IT TOOK ========================================================
-- `convalidated` is false for a constraint that is enforced but unvalidated,
-- which is the expected state here until step 3 above is run.
--
-- SELECT conrelid::regclass AS table_name, conname, convalidated
-- FROM pg_constraint
-- WHERE contype = 'f' AND pg_get_constraintdef(oid) LIKE '%(project_id)%'
-- ORDER BY 1;
