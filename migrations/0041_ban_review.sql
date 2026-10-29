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

-- A chat-line removal has no board_removal row; keep its id so clearing restores the line.
alter table ban_review add column if not exists chat_removal_id text;
create index if not exists ban_review_requested_idx on ban_review (requested_by_user_id, created_at);

-- A cleared removal no longer counts as a strike.
alter table board_removal add column if not exists cleared_at timestamptz;
alter table room_chat_removal add column if not exists cleared_at timestamptz;

-- Every admin decision on a review, including a reversal, in order.
create table if not exists ban_review_event (
  id text primary key,
  review_id text not null references ban_review (id) on delete cascade,
  decision text not null check (decision in ('closed', 'cleared')),
  previous text not null check (previous in ('open', 'closed', 'cleared')),
  by_user_id text references "user" (id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists ban_review_event_review_idx on ban_review_event (review_id, at);

-- The posts each removal took down (the post and the replies that were still up). Clearing
-- or re-closing a review touches only these, so a reply removed on its own stays removed.
alter table board_removal add column if not exists post_ids text[];
