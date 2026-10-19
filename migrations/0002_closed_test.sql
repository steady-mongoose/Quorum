-- The owner must approve this file and migrations/0001_auth.sql before either
-- file is applied to a database and before the pull request that adds them is
-- merged. 0001_auth.sql is a verbatim copy of migrations/auth/0001_auth.sql.
-- The API process does not apply migrations. `npm run db:migrate` does, and
-- only when DATABASE_URL is set.
--
-- Overlap with draft PR #2: that branch keeps the access log in the browser
-- and asks that these shapes not be treated as approved. This file is the
-- server copy of the founding seat, the member grant, and the invite log.
-- It does not add town rooms, council approvals, or theme groups (PR #5).

create table if not exists invite_code (
  id text primary key,
  code_hash text not null unique,
  created_by text not null references "user" ("id") on delete cascade,
  max_uses integer not null check (max_uses >= 1 and max_uses <= 20),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses),
  expires_at timestamptz not null,
  note text not null default '',
  room_id text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists invite_code_created_by_idx on invite_code (created_by);

create table if not exists invite_redemption (
  id text primary key,
  -- SET NULL keeps the names in the log when the code row or the inviter is removed.
  invite_id text references invite_code (id) on delete set null,
  invited_user_id text not null unique references "user" ("id") on delete cascade,
  invited_by_user_id text references "user" ("id") on delete set null,
  invited_name text not null,
  invited_by_name text not null,
  redeemed_at timestamptz not null default now()
);

create index if not exists invite_redemption_inviter_idx
  on invite_redemption (invited_by_user_id, redeemed_at);

create table if not exists member_role (
  user_id text primary key references "user" ("id") on delete cascade,
  is_admin boolean not null default false,
  is_council boolean not null default false,
  is_council_chair boolean not null default false
);

create table if not exists access_log (
  id text primary key,
  user_id text references "user" ("id") on delete set null,
  name text not null,
  role text not null check (role in ('member', 'steward', 'admin')),
  room_id text not null default '',
  action text not null check (action in ('grant', 'revoke')),
  vouched_by text not null,
  approved_by text not null default '',
  by_actor text not null,
  note text not null,
  at timestamptz not null default now()
);

create index if not exists access_log_user_idx on access_log (user_id, role, at);

create table if not exists bootstrap_seat (
  id text primary key check (id = 'founding'),
  user_id text not null unique references "user" ("id") on delete restrict,
  seated_at timestamptz not null default now()
);
