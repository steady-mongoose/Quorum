-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` and the compose "migrate" profile do, and only when
-- DATABASE_URL is set.
--
-- Rows point at objects in S3-compatible storage. The bytes are not in Postgres.
-- Room pictures are processed by the media worker. Message pictures are
-- ciphertext: the server stores the wrapped key and never reads the bytes.

create table if not exists media_object (
  id text primary key,
  owner_user_id text not null references "user" (id) on delete cascade,
  scope text not null check (scope in ('room', 'dm')),
  kind text not null check (kind in ('image', 'video')),
  status text not null check (status in ('pending', 'processing', 'ready', 'rejected')),
  content_type text not null check (
    content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm')
  ),
  byte_size integer not null check (byte_size > 0),
  duration_ms integer,
  room_id text not null default '',
  post_id text not null default '',
  peer_user_id text references "user" (id) on delete cascade,
  encryption text not null check (encryption in ('server-processed', 'client-e2e')),
  key_envelope text not null default '',
  upload_key text not null unique,
  file_key text not null default '',
  thumb_key text not null default '',
  reject_reason text not null default '',
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  constraint media_kind_shape check (
    (kind = 'image' and content_type like 'image/%' and byte_size <= 8388608 and duration_ms is null)
    or
    (kind = 'video' and content_type like 'video/%' and byte_size <= 33554432
      and duration_ms is not null and duration_ms > 0 and duration_ms <= 60000)
  ),
  constraint media_scope_shape check (
    (scope = 'room' and encryption = 'server-processed' and room_id <> '' and post_id <> ''
      and peer_user_id is null and key_envelope = '')
    or
    (scope = 'dm' and encryption = 'client-e2e' and room_id = '' and post_id = ''
      and peer_user_id is not null and length(key_envelope) between 1 and 4096)
  )
);

create index if not exists media_object_owner_idx on media_object (owner_user_id, created_at);
create index if not exists media_object_post_idx on media_object (post_id) where post_id <> '';
create index if not exists media_object_status_idx on media_object (status, created_at);

create table if not exists media_job (
  id text primary key,
  media_id text not null unique references media_object (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  run_after timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text not null default ''
);

create index if not exists media_job_queue_idx on media_job (status, run_after);
