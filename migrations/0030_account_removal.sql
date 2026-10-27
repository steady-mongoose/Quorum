-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0030. 0029 is the member report queue, so account removal is 0030.
-- This file does not change 0010, 0015, or 0017. It does not replace an
-- anonymize function. An author delete sets a timestamp. It does not remove
-- a CSAM hold. Deactivation hides posts until it is cleared. A deletion
-- request is a queue row and an audit row. It does not delete the account.

alter table board_post add column if not exists author_deleted_at timestamptz;

alter table "user" add column if not exists deactivated_at timestamptz;

create table if not exists account_deletion_request (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null default '',
  note text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint account_deletion_request_status_check check (status in ('open', 'done')),
  constraint account_deletion_request_note_check check (char_length(note) <= 500)
);

create unique index if not exists account_deletion_request_one_open_idx
  on account_deletion_request (user_id)
  where status = 'open';

create index if not exists account_deletion_request_open_idx
  on account_deletion_request (created_at, id)
  where status = 'open';

create table if not exists account_audit (
  id text primary key,
  user_id text references "user" (id) on delete set null,
  name text not null default '',
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now(),
  constraint account_audit_action_check check (
    action in ('deactivate', 'reactivate', 'deletion-requested')
  )
);

create index if not exists account_audit_user_idx
  on account_audit (user_id, created_at desc);
