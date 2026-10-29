-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0043. Other numbers are reserved by other pull requests.
-- 0010, 0015, and 0017 are already on production and are not changed here.
-- This file does not replace an anonymize function.
--
-- Members of the same room can message each other, not only people verified at
-- the same gathering. Three guards come with it:
--   1. Either person can block the other. A block stops messages and calls both
--      ways, from a room or a gathering, until the blocker lifts it.
--   2. A member starts a conversation through a room only after three days in
--      it. A steward of the room does not wait.
--   3. A member starts at most five new conversations through rooms a day.
-- The server reads who opened a conversation and through which path to count
-- the daily starts. Messages stay end-to-end encrypted; nothing here reads them.

alter table dm_thread
  add column if not exists opened_by text references "user" ("id") on delete set null,
  add column if not exists opened_via text
    check (opened_via is null or opened_via in ('meeting', 'room'));

create index if not exists dm_thread_opened_idx
  on dm_thread (opened_by, created_at)
  where opened_via = 'room';

create table if not exists dm_block (
  blocker_user_id text not null references "user" ("id") on delete cascade,
  blocked_user_id text not null references "user" ("id") on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

create index if not exists dm_block_blocked_idx on dm_block (blocked_user_id);
