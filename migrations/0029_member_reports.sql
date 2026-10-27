-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0029. 0020 through 0027 are reserved by other pull requests
-- (0027 is the planned moderation migration). 0028 is age attestation.
-- This table is the member report queue. A later moderation migration can
-- extend it. It does not scan files, it does not call Cloudflare, and it
-- does not replace an anonymize function. 0010, 0015, and 0017 are already
-- on production and are not changed here.
--
-- A member reports a room post or a room chat line. Stewards of that room
-- and admins read the open queue. The post text of a CSAM report is not
-- copied into this table.

create table if not exists member_report (
  id text primary key,
  room_id text not null,
  subject_kind text not null check (subject_kind in ('post', 'chat')),
  subject_id text not null,
  reporter_user_id text not null references "user" (id) on delete cascade,
  reason text not null check (reason in ('csam', 'porn', 'threat', 'doxxing', 'blasphemy')),
  note text not null default '' check (char_length(note) <= 500),
  source text not null default 'member' check (source in ('member', 'steward')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null
);

create index if not exists member_report_open_idx
  on member_report (status, created_at);

create unique index if not exists member_report_one_open_idx
  on member_report (reporter_user_id, subject_kind, subject_id)
  where status = 'open';

-- Closing a report. A steward of the room or an admin closes it by hand,
-- or removing the post or chat line closes every open report on it.
-- Each close writes one row to member_report_log.
alter table member_report add column if not exists closed_at timestamptz;
alter table member_report add column if not exists closed_by_user_id text;
alter table member_report add column if not exists resolution text
  check (resolution is null or resolution in ('resolved', 'dismissed', 'removed'));

create table if not exists member_report_log (
  id text primary key,
  report_id text not null references member_report (id) on delete cascade,
  actor_user_id text,
  action text not null check (action in ('close', 'auto-close')),
  resolution text not null check (resolution in ('resolved', 'dismissed', 'removed')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null
);

create index if not exists member_report_log_report_idx
  on member_report_log (report_id, created_at);
