-- Restore three tables that live code queries but production does not have.
--
-- These are not new features. `packages/db/src/database.ts` — generated from a
-- database that had them — carries their full row shape, so they existed on an
-- earlier Supabase project and were never recreated on
-- ulmgvtuqjlzzadlwtiog. No migration in this folder creates them, which is why
-- nothing has healed the gap.
--
-- CONFIRMED BROKEN IN PRODUCTION, not inferred. Against the live API with a
-- real session:
--
--   POST /v1/rpc {"op":"chatWithAssistant"}
--     -> 500 {"code":"internal_error","message":"Failed to create conversation"}
--   POST /v1/rpc {"op":"listPhotoShares"}
--     -> 500 "Could not find the table 'public.photo_shares' in the schema cache"
--   GET  /rest/v1/{conversations,messages,photo_shares}  -> 404 PGRST205
--
-- So the AI assistant and per-photo share links are 100% dead for every
-- customer, on every plan, and have been for as long as this project has been
-- live. Both are advertised features.
--
-- The other six absent tables are deliberately NOT recreated: `subscriptions`
-- is explicitly obsolete (see the comment in lib/team-plan.ts — teams.plan
-- replaced it), and `voice_usage`, `portfolio_items`, `project_page_shares`,
-- `showcase_shares` have zero references in apps/api or apps/web.
-- `project_label_events` also has no table and one reference, in
-- combineProjectsService, which now skips missing tables by error code rather
-- than throwing — so it degrades cleanly and does not need to exist.
--
-- ANON GRANTS ARE REVOKED EXPLICITLY. Supabase ships
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
-- authenticated, service_role`, so a newly created public table is readable by
-- the publishable key the moment it exists — which is exactly how
-- `walkthroughs` and `team_invites` leaked (see 20260811000000). Creating a
-- table without revoking anon is how this class of bug is born, so every table
-- below does it in the same statement block, and
-- `node scripts/verify-anon-exposure.mjs` should be re-run after applying this.
--
-- Apply via the SitePix Supabase SQL editor. Idempotent — safe to re-run.

SET lock_timeout = '5s';


-- === conversations + messages — the AI assistant ==========================
-- Shape from packages/db/src/database.ts. Writes go through ctx.supabase (the
-- caller's JWT, RLS applies) in domains/ai/service.ts:170-185, so the policies
-- below are load-bearing, not decoration.
CREATE TABLE IF NOT EXISTS public.conversations (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  title      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx
  ON public.conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text        NOT NULL,
  content         text        NOT NULL,
  photo_id        uuid        REFERENCES public.photos(id) ON DELETE SET NULL,
  tokens_used     integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- service.ts:188-192 filters on conversation_id and orders by created_at.
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
  ON public.messages(conversation_id, created_at);

REVOKE ALL ON public.conversations FROM anon, PUBLIC;
REVOKE ALL ON public.messages      FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages      TO authenticated;
GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.messages      TO service_role;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages      ENABLE ROW LEVEL SECURITY;

-- A conversation is private to the user who started it. Deliberately NOT
-- team-scoped: these are the user's own questions to the assistant, and nothing
-- in the product offers to share them with a team.
DROP POLICY IF EXISTS "Users manage their own conversations" ON public.conversations;
CREATE POLICY "Users manage their own conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Scoped through the parent conversation as well as user_id, so a row cannot be
-- attached to someone else's thread even if user_id is set correctly.
DROP POLICY IF EXISTS "Users manage their own messages" ON public.messages;
CREATE POLICY "Users manage their own messages" ON public.messages
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
    )
  );


-- === photo_shares — per-photo public share links ==========================
-- createPhotoShareService (domains/photos/shares.ts:59) inserts WITHOUT a
-- token and then reads it back in the same statement, so the default below is
-- what actually mints the share secret. It must stay a default, and it must
-- stay unguessable.
CREATE TABLE IF NOT EXISTS public.photo_shares (
  id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  photo_id       uuid        NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  created_by     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token          text        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  allow_download boolean     NOT NULL DEFAULT false,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- getPublicPhotoShareService looks a share up by token on every public hit.
CREATE INDEX IF NOT EXISTS photo_shares_token_idx    ON public.photo_shares(token);
CREATE INDEX IF NOT EXISTS photo_shares_photo_id_idx ON public.photo_shares(photo_id, created_at DESC);

-- Anon must NOT read this table: the rows hold `token`, and RLS cannot hide a
-- single column. The public share page does not need it — getPublicPhotoShare
-- is a pub() op served by the service-role client, which bypasses RLS. Same
-- shape as the walkthroughs fix in 20260811000000.
REVOKE ALL ON public.photo_shares FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_shares TO authenticated;
GRANT ALL ON public.photo_shares TO service_role;

ALTER TABLE public.photo_shares ENABLE ROW LEVEL SECURITY;

-- Scoped through the photo's project to the same teammate rule the rest of the
-- schema uses (public.are_teammates, defined in 20260612191404_teams.sql), so a
-- teammate can see and revoke a share a colleague created — revocation is a
-- safety control and must not be locked to one person.
DROP POLICY IF EXISTS "Teammates manage photo shares" ON public.photo_shares;
CREATE POLICY "Teammates manage photo shares" ON public.photo_shares
  FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.photos p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = photo_shares.photo_id
        AND public.are_teammates(auth.uid(), pr.created_by)
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.photos p
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE p.id = photo_shares.photo_id
        AND (pr.created_by = auth.uid() OR public.are_teammates(auth.uid(), pr.created_by))
    )
  );


-- === VERIFY ================================================================
-- Expect three rows, anon_select FALSE and authed_select TRUE on every one.
SELECT t.table_name,
       has_table_privilege('anon',          'public.' || t.table_name, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'SELECT') AS authed_select,
       (SELECT relrowsecurity FROM pg_class
         WHERE oid = ('public.' || t.table_name)::regclass)                      AS rls_enabled
FROM (VALUES ('conversations'), ('messages'), ('photo_shares')) AS t(table_name);

-- Then, outside the SQL editor:
--   node scripts/verify-anon-exposure.mjs     -> must still report 0 exposed
--   POST /v1/rpc {"op":"chatWithAssistant","data":{"message":"hi"}}  -> 200
--   POST /v1/rpc {"op":"listPhotoShares","data":{"photoId":"<id>"}}  -> 200
