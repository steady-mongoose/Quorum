-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0018. A gathering stays private until its organizer turns sharing
-- on. The public page stores the title, the date, and the town. It does not
-- store who is coming, a street, or room writing. `shared` defaults to off.
-- A second run is safe. This file does not create or replace a function.

create table if not exists public_gathering (
  id text primary key check (id ~ '^[A-Za-z0-9-]{1,64}$'),
  title text not null check (char_length(title) between 1 and 140),
  gather_on text not null default '' check (char_length(gather_on) <= 10),
  town text not null default '' check (char_length(town) <= 80),
  shared boolean not null default false,
  host_user_id text not null references "user" (id) on delete cascade,
  updated_at timestamptz not null default now()
);
