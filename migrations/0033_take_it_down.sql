-- Numbered 0033. TAKE IT DOWN Act removal requests (0031 and 0032 are taken by queued PRs).
-- Anyone, signed in or not, can ask for an intimate image shared without consent to be removed.
-- Each request gets an ID and is due within 48 hours. An admin removes the file and every
-- identical copy (same SHA-256 of the uploaded bytes), and the hash is blocked from new uploads.
-- Every step is written to takedown_audit.

create table if not exists takedown_request (
  id text primary key,
  requester_name text not null check (char_length(requester_name) between 1 and 120),
  requester_email text not null check (char_length(requester_email) between 3 and 254),
  requester_phone text not null default '' check (char_length(requester_phone) <= 40),
  content_url text not null default '' check (char_length(content_url) <= 2000),
  description text not null default '' check (char_length(description) <= 4000),
  good_faith boolean not null check (good_faith),
  signature text not null check (char_length(signature) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'removed', 'declined')),
  removed_count integer not null default 0,
  decision_note text not null default '',
  decided_by_user_id text references "user" (id) on delete set null,
  created_at timestamptz not null default now(),
  due_at timestamptz not null,
  decided_at timestamptz,
  constraint takedown_request_target check (content_url <> '' or description <> '')
);

create index if not exists takedown_request_open_idx
  on takedown_request (due_at) where status = 'open';

create table if not exists takedown_audit (
  id text primary key,
  request_id text not null references takedown_request (id) on delete cascade,
  action text not null check (action in ('received', 'mailed', 'removed', 'declined')),
  actor_user_id text references "user" (id) on delete set null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists takedown_audit_request_idx on takedown_audit (request_id, created_at);

alter table media_object add column if not exists source_sha256 text not null default '';
create index if not exists media_object_sha_idx
  on media_object (source_sha256) where source_sha256 <> '';

create table if not exists media_block_hash (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  request_id text not null default '',
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'media_worker') then
    grant select on table media_block_hash to media_worker;
  end if;
end
$$;
