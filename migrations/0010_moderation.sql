-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0010. 0006 is reserved by PR #10. 0009 is unused. 0011 is places
-- and is already on production. This file can be applied after 0011.
--
-- Doxxing and blasphemy join the hard-removal rules. Marks gain out_of_scope.
-- The author can appeal a mark or a removal; the appeal and the decision stay
-- in board_appeal. A CSAM removal copies the post into board_csam_hold.
-- Pending counsel: the default retention is 365 days under 18 U.S.C. 2258A
-- as amended by the REPORT Act, and CSAM_HOLD_DAYS may only raise it.
-- The sealed column is ciphertext. No board query returns it. The admin
-- queue reads the other columns only. An unset CSAM_HOLD_KEY still records
-- the hold and an admin alert, and leaves sealed empty. Nothing here is a
-- like, a score, or a rank.
--
-- Account deletion for these tables is anonymize_moderation_user. It does not
-- replace anonymize_board_user. A later migration that rewrites that function
-- must leave this one in place.

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
  author_user_id text references "user" (id) on delete set null,
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
-- refused while the hold is open. A purged or expired row drops the author
-- id in anonymize_moderation_user so the account can be deleted.
create table if not exists board_csam_hold (
  id text primary key,
  post_id text not null,
  post_ids text[] not null,
  room_id text not null,
  author_user_id text references "user" (id) on delete restrict,
  author_name text not null,
  sealed text not null,
  seal_status text not null default 'sealed',
  media_count integer not null check (media_count >= 0),
  byte_size integer not null check (byte_size >= 0),
  media_types text[] not null default '{}',
  created_at timestamptz not null,
  retain_until timestamptz not null,
  purged_at timestamptz,
  filed_at timestamptz,
  report_id text not null default '',
  filed_by_user_id text references "user" (id) on delete set null,
  filed_by_name text not null default '',
  constraint board_csam_hold_seal_status_check check (seal_status in ('sealed', 'pending_seal')),
  constraint board_csam_hold_filed_check check (
    (filed_at is null and report_id = '' and filed_by_name = '')
    or (filed_at is not null and char_length(report_id) between 1 and 64)
  )
);

-- A second run, or a database that already created the narrower table, adds
-- the columns and rebuilds the checks. ADD CONSTRAINT is safe because the
-- previous constraint is dropped first.
alter table board_csam_hold add column if not exists seal_status text not null default 'sealed';
alter table board_csam_hold add column if not exists filed_at timestamptz;
alter table board_csam_hold add column if not exists report_id text not null default '';
alter table board_csam_hold add column if not exists filed_by_user_id text;
alter table board_csam_hold add column if not exists filed_by_name text not null default '';
alter table board_csam_hold alter column author_user_id drop not null;

alter table board_csam_hold drop constraint if exists board_csam_hold_author_user_id_fkey;
alter table board_csam_hold
  add constraint board_csam_hold_author_user_id_fkey
  foreign key (author_user_id) references "user" (id) on delete restrict;

alter table board_csam_hold drop constraint if exists board_csam_hold_filed_by_user_id_fkey;
alter table board_csam_hold
  add constraint board_csam_hold_filed_by_user_id_fkey
  foreign key (filed_by_user_id) references "user" (id) on delete set null;

alter table board_csam_hold drop constraint if exists board_csam_hold_seal_status_check;
alter table board_csam_hold
  add constraint board_csam_hold_seal_status_check
  check (seal_status in ('sealed', 'pending_seal'));

alter table board_csam_hold drop constraint if exists board_csam_hold_filed_check;
alter table board_csam_hold
  add constraint board_csam_hold_filed_check
  check (
    (filed_at is null and report_id = '' and filed_by_name = '')
    or (filed_at is not null and char_length(report_id) between 1 and 64)
  );

-- No post text and no file bytes. kind names the alert.
create table if not exists board_admin_alert (
  id text primary key,
  kind text not null,
  hold_id text not null,
  created_at timestamptz not null,
  constraint board_admin_alert_kind_check check (kind in ('csam_hold', 'csam_pending_seal'))
);

alter table board_admin_alert drop constraint if exists board_admin_alert_kind_check;
alter table board_admin_alert
  add constraint board_admin_alert_kind_check
  check (kind in ('csam_hold', 'csam_pending_seal'));

create index if not exists board_csam_hold_open_idx
  on board_csam_hold (post_id)
  where purged_at is null;

-- Names on an appeal are dropped when the account is deleted. The sentence
-- stays. This trigger is not anonymize_board_user. An open CSAM hold keeps
-- author_user_id, and on delete restrict refuses the account deletion. A
-- purged row, or one whose retain_until has passed, drops the author here so
-- it does not block that deletion.
create or replace function anonymize_moderation_user() returns trigger
language plpgsql
as $$
begin
  update board_appeal
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update board_appeal
    set decided_by_user_id = null, decided_by_name = 'Removed member'
    where decided_by_user_id = old.id;
  update board_csam_hold
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id
      and (purged_at is not null or retain_until <= now());
  update board_csam_hold
    set filed_by_user_id = null, filed_by_name = 'Removed member'
    where filed_by_user_id = old.id;
  return old;
end;
$$;

-- Theme-group and room-chat checks are created by later files. When this
-- migration is applied after those tables exist, widen them here too.
-- 0015 does the same for a fresh database, where this block is a no-op.

drop trigger if exists anonymize_moderation_user on "user";
create trigger anonymize_moderation_user
  before delete on "user"
  for each row execute function anonymize_moderation_user();

-- Widen hard-removal checks when the theme-group or room-chat tables are
-- already present. A fresh database creates those tables in a later file;
-- 0015 repeats this block so the later create is widened too.
do $$
declare
  cons name;
begin
  if to_regclass('public.theme_group_post') is not null then
    for cons in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.theme_group_post'::regclass
        and c.contype = 'c'
        and c.conname is distinct from 'theme_group_post_removal_pair'
        and pg_get_constraintdef(c.oid) ilike '%removed_for%'
        and pg_get_constraintdef(c.oid) ilike '%csam%'
    loop
      execute format('alter table theme_group_post drop constraint %I', cons);
    end loop;
    alter table theme_group_post
      add constraint theme_group_post_removed_for_check
      check (removed_for is null or removed_for in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));
  end if;

  if to_regclass('public.theme_group_removal') is not null then
    for cons in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.theme_group_removal'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%reason%'
        and pg_get_constraintdef(c.oid) ilike '%csam%'
    loop
      execute format('alter table theme_group_removal drop constraint %I', cons);
    end loop;
    alter table theme_group_removal
      add constraint theme_group_removal_reason_check
      check (reason in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));
  end if;

  if to_regclass('public.room_chat_removal') is not null then
    for cons in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.room_chat_removal'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%reason%'
        and pg_get_constraintdef(c.oid) ilike '%csam%'
    loop
      execute format('alter table room_chat_removal drop constraint %I', cons);
    end loop;
    alter table room_chat_removal
      add constraint room_chat_removal_reason_check
      check (reason in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));
  end if;
end $$;
