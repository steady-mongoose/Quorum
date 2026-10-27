-- Numbered 0041 (0037-0040 are taken). Only an admin closes an account for good.
-- When a steward's removal would close an account (a pornography or CSAM removal,
-- or a second strike), the member is barred site-wide for 30 days and the case
-- waits here for an admin. The admin closes the account or leaves the 30-day bar.
create table if not exists ban_review (
  id text primary key,
  ban_id text not null references board_ban (id) on delete cascade,
  user_id text references "user" (id) on delete set null,
  reason text not null,
  requested_by_user_id text references "user" (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed', 'kept')),
  decided_by_user_id text references "user" (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists ban_review_open_idx on ban_review (created_at) where status = 'open';
