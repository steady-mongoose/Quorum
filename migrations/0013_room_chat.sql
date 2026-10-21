-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0013. 0006 is reserved by PR #10 for end-to-end 1:1 messages
-- (dm_identity, dm_device, dm_message, dm_envelope, and the rest). This file
-- does not create or alter those tables.
--
-- Room chat is plain text. Group encryption is a later change: a removed
-- member must not be able to read lines sent after they leave, which needs a
-- new epoch and a rekey. That is not a small extension of the 1:1 design.
-- A later migration can add ciphertext. Do not store a key envelope here.
--
-- Nothing here counts approval or orders a line by popularity.

create table if not exists room_chat_message (
  id text primary key,
  room_id text not null references room (id),
  author_user_id text references "user" (id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) between 1 and 2000),
  removed boolean not null default false,
  seq bigint generated always as identity,
  created_at timestamptz not null,
  removed_at timestamptz
);

create index if not exists room_chat_message_room_order_idx
  on room_chat_message (room_id, created_at asc, seq asc);

create index if not exists room_chat_message_room_seq_idx
  on room_chat_message (room_id, seq);

create table if not exists room_chat_removal (
  id text primary key,
  message_id text not null references room_chat_message (id) on delete cascade,
  room_id text not null references room (id),
  author_user_id text references "user" (id) on delete set null,
  author_name text not null,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  reason text not null check (reason in ('threat', 'porn', 'csam')),
  created_at timestamptz not null default now()
);

create index if not exists room_chat_removal_author_idx
  on room_chat_removal (author_user_id, created_at desc);

create index if not exists room_chat_removal_message_idx
  on room_chat_removal (message_id);

create index if not exists room_chat_removal_room_idx
  on room_chat_removal (room_id, created_at desc);

-- Deleting an account keeps the chat line and drops the name.
-- This function is only for these two tables. It does not replace
-- anonymize_board_user from 0008, so a later migration's own trigger
-- stays in place when this file is applied.
create or replace function anonymize_room_chat_user() returns trigger
language plpgsql
as $$
begin
  update room_chat_message
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update room_chat_removal
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update room_chat_removal
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_room_chat_user on "user";
create trigger anonymize_room_chat_user
  before delete on "user"
  for each row execute function anonymize_room_chat_user();
