-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` and the compose "migrate" profile do, and only when
-- DATABASE_URL is set.
--
-- Rows point at objects in S3-compatible storage. The bytes are not in Postgres.
-- Room pictures are processed by the media worker. Message pictures are
-- ciphertext: the server stores the wrapped key and never reads the bytes.
--
-- Deleting a member tombstones pictures that member sent. A message picture
-- the other person sent stays, with the peer pointer cleared. A sweep deletes
-- tombstoned objects before it deletes the rows.

create table if not exists room (
  id text primary key
);

insert into room (id) values
  ('county'),
  ('question'),
  ('shop'),
  ('shelf'),
  ('coop'),
  ('baptist'),
  ('presbyterian'),
  ('latin'),
  ('orthodox'),
  ('dispatch')
on conflict do nothing;

create table if not exists room_member (
  room_id text not null references room (id),
  user_id text not null references "user" (id) on delete cascade,
  primary key (room_id, user_id)
);

create table if not exists room_post (
  id text primary key,
  room_id text not null references room (id),
  author_user_id text not null references "user" (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists room_post_room_idx on room_post (room_id, author_user_id);

create table if not exists media_object (
  id text primary key,
  owner_user_id text references "user" (id) on delete set null,
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
  peer_user_id text references "user" (id) on delete set null,
  encryption text not null check (encryption in ('server-processed', 'client-e2e')),
  key_envelope text not null default '',
  upload_key text not null unique,
  file_key text not null default '',
  thumb_key text not null default '',
  reject_reason text not null default '',
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  deleted_at timestamptz,
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
      and length(key_envelope) between 1 and 4096
      and (peer_user_id is not null or deleted_at is not null or owner_user_id is not null))
  )
);

create index if not exists media_object_owner_idx on media_object (owner_user_id, created_at);
create index if not exists media_object_post_idx on media_object (post_id) where post_id <> '';
create index if not exists media_object_status_idx on media_object (status, created_at);
create index if not exists media_object_peer_idx on media_object (peer_user_id) where peer_user_id is not null;
create index if not exists media_object_deleted_idx on media_object (deleted_at) where deleted_at is not null;

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

-- A new message row must name the other person. Clearing that pointer is only
-- for the case where that account has been deleted.
create or replace function media_peer_on_insert() returns trigger as $$
begin
  if new.scope = 'dm' and new.peer_user_id is null then
    raise exception 'A message picture needs the other person.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists media_peer_on_insert on media_object;
create trigger media_peer_on_insert
  before insert on media_object
  for each row execute function media_peer_on_insert();

-- Tombstone pictures this member sent. Leave pictures addressed to them.
create or replace function media_on_user_delete() returns trigger as $$
begin
  update media_object
    set deleted_at = coalesce(deleted_at, now())
    where owner_user_id = old.id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists media_user_delete on "user";
create trigger media_user_delete
  before delete on "user"
  for each row execute function media_on_user_delete();
