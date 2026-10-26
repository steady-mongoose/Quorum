-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0018. A gathering is a server row. Sharing is a switch on that
-- row and defaults to off. The public page reads the live title, the date,
-- the time, and the town. It does not store who is coming, a street, or
-- room writing. The id is a UUID. A second run is safe. This file does not
-- create or replace a function.

create table if not exists public_gathering (
  id text primary key,
  title text not null check (char_length(title) between 1 and 140),
  gather_on text not null default '' check (char_length(gather_on) <= 10),
  gather_time text not null default '' check (char_length(gather_time) <= 120),
  town text not null default '' check (char_length(town) <= 80),
  place text not null default '' check (char_length(place) <= 240),
  room_id text not null default '',
  shared boolean not null default false,
  removed boolean not null default false,
  host_user_id text not null references "user" (id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint public_gathering_id_check check (
    id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

alter table public_gathering add column if not exists gather_time text not null default '';
alter table public_gathering add column if not exists place text not null default '';
alter table public_gathering add column if not exists room_id text not null default '';
alter table public_gathering add column if not exists removed boolean not null default false;

-- Rows created before ids were UUIDs cannot be a stored gathering.
delete from public_gathering
where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

alter table public_gathering drop constraint if exists public_gathering_id_check;
alter table public_gathering add constraint public_gathering_id_check check (
  id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

alter table public_gathering drop constraint if exists public_gathering_gather_time_check;
alter table public_gathering add constraint public_gathering_gather_time_check
  check (char_length(gather_time) <= 120);

alter table public_gathering drop constraint if exists public_gathering_place_check;
alter table public_gathering add constraint public_gathering_place_check
  check (char_length(place) <= 240);

create index if not exists public_gathering_host_idx
  on public_gathering (host_user_id)
  where removed = false;
