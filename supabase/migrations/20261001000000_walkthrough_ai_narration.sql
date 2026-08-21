-- Walkthrough AI narration: the payload behind the premium Summary.
--
-- A Summary is now the flagship output of recording a walkthrough - the video
-- with an AI narration track over its timeline, plus one AI-written narration
-- per captured photo. `summary_markdown` cannot carry that: it is prose meant
-- for reading, and the player needs structure with real second offsets it can
-- seek to and highlight.
--
-- Shape (apps/api/src/domains/walkthroughs/narration.ts is the authority):
--   {
--     "version": 1,
--     "hasSpeech": true,
--     "headline": "...",
--     "aiGenerated": true,
--     "chapters": [{ "start": 0, "end": 45, "title": "...", "narration": "..." }],
--     "photos":   [{ "photoId": "...", "offsetSeconds": 12,
--                    "narration": "...", "spoken": "..." | null }]
--   }
--
-- `spoken` is null when nobody spoke near that photo, and that is load-bearing:
-- the UI renders a narrated shot and a silent one differently, which was the
-- whole complaint about the old generic photo-caption card.
--
-- Nullable with no default. Every read path treats a missing payload as "not
-- generated yet" and falls back to the deterministic photo-note rendering, so
-- existing walkthroughs keep working until they are next generated.

alter table public.walkthroughs
  add column if not exists narration_json jsonb;

comment on column public.walkthroughs.narration_json is
  'AI narration for the premium Summary: timed chapters for the player plus per-photo narration. See apps/api/src/domains/walkthroughs/narration.ts.';

-- The narration is read alongside the walkthrough row it belongs to, so it
-- inherits that row''s RLS. No new policy: anything that can read a
-- walkthrough can read its narration, and nothing else can.
