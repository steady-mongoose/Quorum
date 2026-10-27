-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0032. Other numbers are reserved by other pull requests.
-- 0010, 0015, and 0017 are already on production and are not changed here.
-- This file does not replace an anonymize function.
--
-- A member reports a direct message they received. Messages are end-to-end
-- encrypted, so the server cannot read them. The reporter may choose to share
-- the text they see; it is stored as "shared by the reporter" and cannot be
-- verified by the server. For a CSAM report no text is kept.
-- Only admins read and close DM reports. A message under an open report is not
-- swept at 30 days until the report is closed.

create table if not exists dm_report (
  id text primary key,
  message_id text references dm_message (id) on delete set null,
  thread_id text references dm_thread (id) on delete set null,
  reporter_user_id text references "user" (id) on delete set null,
  reported_user_id text references "user" (id) on delete set null,
  reported_name text not null default '',
  reason text not null check (reason in ('csam', 'porn', 'threat', 'doxxing', 'blasphemy')),
  note text not null default '' check (char_length(note) <= 500),
  shared_text text not null default '' check (char_length(shared_text) <= 4000),
  message_sent_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  resolution text check (resolution is null or resolution in ('resolved', 'dismissed')),
  created_at timestamptz not null,
  closed_at timestamptz,
  closed_by_user_id text references "user" (id) on delete set null
);

create index if not exists dm_report_open_idx on dm_report (status, created_at);
create index if not exists dm_report_message_idx on dm_report (message_id) where status = 'open';

create unique index if not exists dm_report_one_open_idx
  on dm_report (reporter_user_id, message_id)
  where status = 'open';
