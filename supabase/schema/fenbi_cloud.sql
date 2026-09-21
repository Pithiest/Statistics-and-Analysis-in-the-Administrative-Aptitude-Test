-- Separate, server-only account storage. Existing training tables remain unchanged.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.xc_fb_accounts (
  id uuid primary key default gen_random_uuid(),
  provider_key text unique not null,
  display_name text not null default '粉笔同学',
  session_cipher text,
  notebook jsonb not null default '{"schemaVersion":1,"questions":[],"lastImportedAt":null}',
  progress jsonb not null default '[]',
  progress_revision bigint not null default 0,
  last_sync timestamptz,
  last_attempt timestamptz,
  next_sync timestamptz not null default now(),
  sync_state text not null default 'queued',
  last_error text,
  sync_cursor jsonb,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.xc_fb_sessions (
  token_hash text primary key,
  account_id uuid not null references public.xc_fb_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists xc_fb_sessions_account_idx on public.xc_fb_sessions(account_id);
create table if not exists public.xc_fb_logins (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  state_cipher text not null,
  ip_hash text not null,
  expires_at timestamptz not null,
  last_poll_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists xc_fb_logins_ip_idx on public.xc_fb_logins(ip_hash,created_at);
alter table public.xc_fb_accounts enable row level security;
alter table public.xc_fb_sessions enable row level security;
alter table public.xc_fb_logins enable row level security;
revoke all on public.xc_fb_accounts, public.xc_fb_sessions, public.xc_fb_logins from public, anon, authenticated;
grant select, insert, update, delete on public.xc_fb_accounts, public.xc_fb_sessions, public.xc_fb_logins to service_role;

do $$ begin
  if not exists(select 1 from vault.secrets where name='xc_fenbi_runtime_v1') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'xc_fenbi_runtime_v1','Encryption and internal job authentication for private Fenbi integration');
  end if;
end $$;

create or replace function public.xc_fb_runtime_key() returns text
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'forbidden'; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name='xc_fenbi_runtime_v1' limit 1);
end $$;
revoke all on function public.xc_fb_runtime_key() from public, anon, authenticated;
grant execute on function public.xc_fb_runtime_key() to service_role;

create or replace function public.xc_fb_claim_job() returns setof public.xc_fb_accounts
language sql security invoker set search_path='' as $$
  update public.xc_fb_accounts set locked_until=now()+interval '180 seconds', sync_state='syncing',last_attempt=now()
  where id=(select id from public.xc_fb_accounts
    where session_cipher is not null and sync_state not in ('reauth','paused') and next_sync<=now()
      and (locked_until is null or locked_until<now())
    order by next_sync for update skip locked limit 1)
  returning *;
$$;
revoke all on function public.xc_fb_claim_job() from public, anon, authenticated;
grant execute on function public.xc_fb_claim_job() to service_role;

-- Application synchronization runs in the cloud, independently of any Mac or ChatGPT task.
select cron.schedule('xc-fenbi-sync-v1','* * * * *', $job$
  select net.http_post(
    url:='https://atwsraivphybkfmyeubd.supabase.co/functions/v1/fenbi-cloud/worker',
    headers:=jsonb_build_object('Content-Type','application/json','X-Fenbi-Worker',
      (select decrypted_secret from vault.decrypted_secrets where name='xc_fenbi_runtime_v1' limit 1)),
    body:='{}'::jsonb, timeout_milliseconds:=90000);
$job$);

-- Daily at 19:20 UTC (03:20 Asia/Shanghai): remove only expired login/session secrets.
-- Keep a one-day grace period for QR diagnostics; never remove accounts, notebooks or progress.
select cron.schedule('xc-fenbi-session-cleanup-v1','20 19 * * *', $job$
  with expired_logins as (
    delete from public.xc_fb_logins where expires_at < now() - interval '1 day' returning 1
  ), expired_sessions as (
    delete from public.xc_fb_sessions where expires_at < now() returning 1
  )
  select (select count(*) from expired_logins) as removed_logins,
         (select count(*) from expired_sessions) as removed_sessions;
$job$);

-- Status polling never transfers complete question payloads.
create or replace view public.xc_fb_account_status with (security_invoker=true) as
select id,display_name,last_sync,last_attempt,next_sync,sync_state,last_error,progress_revision,
session_cipher is not null as has_provider_session,
notebook->>'lastImportedAt' as source_stamp,
jsonb_array_length(coalesce(notebook->'questions','[]'::jsonb)) as question_count,
jsonb_array_length(coalesce(sync_cursor->'requestedQuestionIds','[]'::jsonb)) as sync_total,
(select coalesce(sum(jsonb_array_length(coalesce(b->'solutions','[]'::jsonb))),0) from jsonb_array_elements(coalesce(sync_cursor->'batches','[]'::jsonb)) b) as sync_loaded
from public.xc_fb_accounts;
revoke all on public.xc_fb_account_status from public,anon,authenticated;
grant select on public.xc_fb_account_status to service_role;
