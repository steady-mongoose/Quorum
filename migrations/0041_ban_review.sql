-- Numbered 0041 (0037-0040 are taken). Only an admin bans an account for good.
-- When a steward's removal would close an account (a pornography or CSAM removal,
-- or a second strike), the content is removed and the member is suspended
-- site-wide at once (a board_ban row) and flagged here. An admin then makes the
-- ban permanent ('closed') or lifts the suspension because the member is
-- cleared ('cleared'). Every decision is recorded here. CSAM is never cleared.
create table if not exists ban_review (
  id text primary key,
  ban_id text references board_ban (id) on delete set null,
  removal_id text,
  user_id text references "user" (id) on delete set null,
  name text not null default '',
  reason text not null,
  strikes integer not null default 1,
  room_id text not null default '',
  requested_by_user_id text references "user" (id) on delete set null,
  requested_by_name text not null default '',
  status text not null default 'open' check (status in ('open', 'closed', 'cleared')),
  decided_by_user_id text references "user" (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists ban_review_open_idx on ban_review (created_at) where status = 'open';
