-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0019. 0006 is reserved by PR #10. 0018 is the public gathering.
-- Deleting an account runs anonymize_gender_user. It clears the gender
-- words on the audit row and drops the members row. It does not replace
-- anonymize_board_user or any other anonymize function.
--
-- A member may state man or woman once. The columns live on `members`.
-- A room may be for everyone, men, or women. The rooms list is `room`,
-- and `audience` is that limit. It defaults to everyone.
-- Nothing here is a like, a reshare, a score, or a rank.

create table if not exists members (
  user_id text primary key references "user" (id) on delete cascade,
  gender text,
  gender_confirmed_by text references "user" (id) on delete set null,
  gender_confirmed_at timestamptz
);

alter table members drop constraint if exists members_gender_check;
alter table members add constraint members_gender_check
  check (gender is null or gender in ('man', 'woman'));

alter table room add column if not exists audience text not null default 'all';
alter table room drop constraint if exists room_audience_check;
alter table room add constraint room_audience_check
  check (audience in ('all', 'men', 'women'));

-- A theme group created from a room keeps that room's audience.
alter table theme_group add column if not exists audience text not null default 'all';
alter table theme_group add column if not exists source_room_id text not null default '';
alter table theme_group drop constraint if exists theme_group_audience_check;
alter table theme_group add constraint theme_group_audience_check
  check (audience in ('all', 'men', 'women'));

-- Steward overrides, gender changes, and audience edits. One row each time.
create table if not exists gender_audit (
  id text primary key,
  actor_user_id text references "user" (id) on delete set null,
  subject_user_id text references "user" (id) on delete set null,
  room_id text not null default '',
  action text not null,
  path text not null default '',
  detail text not null default '',
  at timestamptz not null default now()
);

alter table gender_audit drop constraint if exists gender_audit_action_check;
alter table gender_audit add constraint gender_audit_action_check check (
  action in (
    'set-gender',
    'change-gender',
    'confirm-gender',
    'set-audience',
    'audience-override'
  )
);

create index if not exists gender_audit_room_idx on gender_audit (room_id, at desc);

-- Gender words in the audit detail are dropped with the account. The members
-- row is deleted here as well. This trigger is not anonymize_board_user.
create or replace function anonymize_gender_user() returns trigger
language plpgsql
as $$
begin
  delete from members where user_id = old.id;
  update gender_audit
    set detail = ''
    where actor_user_id = old.id or subject_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_gender_user on "user";
create trigger anonymize_gender_user
  before delete on "user"
  for each row execute function anonymize_gender_user();
