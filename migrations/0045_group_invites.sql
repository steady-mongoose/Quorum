-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0045. Other numbers are reserved by other pull requests.
-- 0012 is already on production. This file adds to it and does not replace
-- an anonymize function.
--
-- Theme groups are joined by invitation. A group admin or a steward of the
-- group invites one member by email. The invite stays open until that member
-- joins, declines it, or someone revokes it. A revoked or declined invite
-- does not let anyone join.
-- Nothing here is a count, a like, a score, or a rank.

create table if not exists theme_group_invite (
  id text primary key,
  group_id text not null references theme_group (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id text references "user" (id) on delete set null,
  revoked_by_name text not null default '',
  declined_at timestamptz
);

-- One open invite per member per group.
create unique index if not exists theme_group_invite_open_idx
  on theme_group_invite (group_id, user_id)
  where used_at is null and revoked_at is null and declined_at is null;

create index if not exists theme_group_invite_group_idx
  on theme_group_invite (group_id, created_at desc);

-- The group log records invites and revokes too.
alter table theme_group_log drop constraint if exists theme_group_log_action_check;
alter table theme_group_log
  add constraint theme_group_log_action_check
  check (action in (
    'request', 'approve', 'refuse',
    'join', 'leave',
    'grant-admin', 'revoke-admin',
    'grant-steward', 'revoke-steward',
    'post', 'mark', 'clear', 'remove',
    'appeal', 'uphold', 'lift',
    'invite', 'revoke-invite', 'decline-invite'
  ));

-- Deleting an account drops the name from invites it sent or revoked.
-- This is its own function and trigger.
create or replace function anonymize_theme_group_invite_user() returns trigger
language plpgsql
as $$
begin
  update theme_group_invite
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update theme_group_invite
    set revoked_by_user_id = null, revoked_by_name = 'Removed member'
    where revoked_by_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_theme_group_invite_user on "user";
create trigger anonymize_theme_group_invite_user
  before delete on "user"
  for each row execute function anonymize_theme_group_invite_user();
