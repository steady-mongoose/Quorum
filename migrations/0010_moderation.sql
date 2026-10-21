-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0010. 0006 is reserved by PR #10. 0009 is unused.
--
-- Doxxing and blasphemy join the hard-removal rules. Marks gain out_of_scope.
-- The author can appeal a mark or a removal; the appeal and the decision stay
-- in board_appeal. A CSAM removal copies the post into board_csam_hold for 90
-- days (18 U.S.C. 2258A). The sealed column is ciphertext. No board query
-- returns it. The admin queue reads the other columns only. Nothing here is a
-- like, a score, or a rank.

-- Inline checks in 0008 were named for the column. Drop those, then add the
-- wider lists. A second run is safe because of IF EXISTS.
alter table board_post drop constraint if exists board_post_mark_check;
alter table board_mark drop constraint if exists board_mark_mark_check;
alter table board_removal drop constraint if exists board_removal_reason_check;
alter table board_ban drop constraint if exists board_ban_reason_check;

alter table board_post
  add constraint board_post_mark_check
  check (mark is null or mark in ('sloppy', 'unsupported', 'out_of_scope'));

alter table board_mark
  add constraint board_mark_mark_check
  check (mark is null or mark in ('sloppy', 'unsupported', 'out_of_scope'));

alter table board_removal
  add constraint board_removal_reason_check
  check (reason in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));

alter table board_ban
  add constraint board_ban_reason_check
  check (reason in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));

create table if not exists board_appeal (
  id text primary key,
  room_id text not null references room (id),
  post_id text not null references board_post (id) on delete cascade,
  author_user_id text not null references "user" (id) on delete cascade,
  author_name text not null,
  kind text not null check (kind in ('mark', 'removal')),
  target_id text not null,
  reason text not null check (char_length(reason) between 8 and 200),
  decision text,
  decision_note text not null default '',
  decided_by_user_id text references "user" (id) on delete set null,
  decided_by_name text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint board_appeal_decision_check check (
    (
      decision is null
      and decided_at is null
      and decision_note = ''
      and decided_by_name = ''
    )
    or (
      decision in ('uphold', 'lift')
      and decided_at is not null
      and char_length(decision_note) between 8 and 200
    )
  )
);

create unique index if not exists board_appeal_open_idx
  on board_appeal (post_id, kind)
  where decision is null;

create index if not exists board_appeal_room_idx on board_appeal (room_id, created_at desc);

-- Sealed hold for a CSAM removal. `sealed` is ciphertext and is not selected
-- by the board. `post_ids` names the post and its replies so the hold can
-- find their files without opening the ciphertext. Deleting the account is
-- refused while the hold exists.
create table if not exists board_csam_hold (
  id text primary key,
  post_id text not null,
  post_ids text[] not null,
  room_id text not null,
  author_user_id text not null references "user" (id) on delete restrict,
  author_name text not null,
  sealed text not null,
  media_count integer not null check (media_count >= 0),
  byte_size integer not null check (byte_size >= 0),
  media_types text[] not null default '{}',
  created_at timestamptz not null,
  retain_until timestamptz not null,
  purged_at timestamptz
);

create index if not exists board_csam_hold_open_idx
  on board_csam_hold (post_id)
  where purged_at is null;
