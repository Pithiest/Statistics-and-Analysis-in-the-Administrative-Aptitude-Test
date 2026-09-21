-- Per-account practice records are independent of shared space codes.
alter table public.xc_fb_accounts add column if not exists history_cursor jsonb;
alter table public.xc_fb_accounts add column if not exists history_updated_at timestamptz;
alter table public.xc_fb_accounts add column if not exists history_complete boolean not null default false;
alter table public.xc_fb_accounts add column if not exists history_count integer not null default 0;
alter table public.xc_fb_accounts add column if not exists history_excluded integer not null default 0;
create table if not exists public.xc_fb_exercises (
 account_id uuid not null references public.xc_fb_accounts(id) on delete cascade,
 exercise_key text not null,
 source_version text not null,
 payload jsonb not null,
 reviewed_at timestamptz,
 primary key(account_id,exercise_key)
);
create table if not exists public.xc_fb_question_cache (
 account_id uuid not null references public.xc_fb_accounts(id) on delete cascade,
 question_id text not null,
 question jsonb not null,
 primary key(account_id,question_id)
);
alter table public.xc_fb_exercises enable row level security;
alter table public.xc_fb_question_cache enable row level security;
revoke all on public.xc_fb_exercises, public.xc_fb_question_cache from public,anon,authenticated;
grant select,insert,update,delete on public.xc_fb_exercises,public.xc_fb_question_cache to service_role;
create or replace view public.xc_fb_account_status with (security_invoker=true) as
select id,display_name,last_sync,last_attempt,next_sync,sync_state,last_error,progress_revision,
session_cipher is not null as has_provider_session,
notebook->>'lastImportedAt' as source_stamp,
jsonb_array_length(coalesce(notebook->'questions','[]'::jsonb)) as question_count,
jsonb_array_length(coalesce(sync_cursor->'requestedQuestionIds','[]'::jsonb)) as sync_total,
(select coalesce(sum(jsonb_array_length(coalesce(b->'solutions','[]'::jsonb))),0) from jsonb_array_elements(coalesce(sync_cursor->'batches','[]'::jsonb)) b) as sync_loaded,
history_updated_at,history_complete,history_count,history_excluded,
case when sync_cursor->>'stage'='history' then 'history' else 'mistakes' end as sync_stage
from public.xc_fb_accounts;
revoke all on public.xc_fb_account_status from public,anon,authenticated;
grant select on public.xc_fb_account_status to service_role;
