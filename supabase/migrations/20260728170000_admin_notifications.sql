-- Admin dashboard: broadcast/announcement notifications.
-- Extends the notifications.type check to allow a platform-admin-sent type,
-- distinct from the existing user-activity types (task/checklist/comment/invite).
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog). Idempotent.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'task_assigned', 'checklist_assigned', 'photo_comment_mention', 'team_invite_accepted', 'admin_announcement'
));
