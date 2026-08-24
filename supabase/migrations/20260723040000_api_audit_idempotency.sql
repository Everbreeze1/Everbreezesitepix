-- Phase E: privileged API audit trail + idempotency keys (service-role only).
-- Apply to Everlumen project before relying on Idempotency-Key in production.

create table if not exists public.api_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null,
  route text not null,
  op text null,
  http_status integer not null,
  duration_ms integer null,
  request_id text null,
  idempotency_key text null,
  error_code text null,
  meta jsonb null
);

create index if not exists api_audit_logs_created_at_idx
  on public.api_audit_logs (created_at desc);

create index if not exists api_audit_logs_user_id_created_at_idx
  on public.api_audit_logs (user_id, created_at desc);

create index if not exists api_audit_logs_op_created_at_idx
  on public.api_audit_logs (op, created_at desc)
  where op is not null;

alter table public.api_audit_logs enable row level security;
-- No policies: authenticated clients cannot read/write; service role bypasses RLS.

create table if not exists public.api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null,
  scope text not null,
  key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  response_status integer null,
  response_body jsonb null,
  constraint api_idempotency_keys_user_scope_key unique (user_id, scope, key)
);

create index if not exists api_idempotency_keys_created_at_idx
  on public.api_idempotency_keys (created_at);

alter table public.api_idempotency_keys enable row level security;
-- No policies: service role only.

comment on table public.api_audit_logs is
  'Everlumen /v1 privileged call audit (service-role writes).';
comment on table public.api_idempotency_keys is
  'Idempotency-Key cache for expensive /v1 ops (service-role).';
