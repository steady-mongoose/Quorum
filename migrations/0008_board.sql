-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0008. 0006 is reserved by PR #10.
--
-- Rooms, posts, steward marks, hard removals, and bans. Members read the same
-- rows. Marks stay on the post; they do not hide it. Nothing here is a like,
-- a reshare, a score, or a rank. Post order is a fixed tier, then time.

alter table room
  add column if not exists name text not null default '',
  add column if not exists what text not null default '',
  add column if not exists takes text[] not null default '{}',
  add column if not exists steward_takes text[] not null default '{}',
  add column if not exists card_kinds text[] not null default '{}',
  add column if not exists card_noun text not null default 'Meeting'
    check (card_noun in ('Meeting', 'Service', 'Reading', 'Debate')),
  add column if not exists requires_next_date boolean not null default false,
  add column if not exists parish boolean not null default false,
  add column if not exists sort_order integer not null default 100,
  add column if not exists created_by text references "user" (id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

update room set
  name = 'The County',
  what = $text$County hearings, bills, and the week's coordinated phone call to one official. Candidate events are allowed, labeled as such.$text$,
  takes = array['did', 'asked', 'hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting', 'candidate'],
  card_noun = 'Meeting',
  requires_next_date = false,
  parish = false,
  sort_order = 0
where id = 'county';

update room set
  name = 'Debate Night',
  what = $text$A debate once a month at a brewery or a hall. One question, two sides, a Christian host, anyone welcome. Afterwards the host writes up how it went and names next month's question.$text$,
  takes = array['did', 'asked', 'hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting'],
  card_noun = 'Debate',
  requires_next_date = true,
  parish = false,
  sort_order = 1
where id = 'question';

update room set
  name = 'The Shop',
  what = 'Hands-on nights: woodworking, the radio net, the gym hour. Also the directory of tradesmen that members have vouched for.',
  takes = array['did', 'asked', 'hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting', 'trade'],
  card_noun = 'Meeting',
  requires_next_date = true,
  parish = false,
  sort_order = 2
where id = 'shop';

update room set
  name = 'Literary Society',
  what = 'A reading group. One book at a time, a few chapters between meetings, talked through around a table. The host says what to read before next time.',
  takes = array['did', 'asked', 'hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting'],
  card_noun = 'Reading',
  requires_next_date = true,
  parish = false,
  sort_order = 3
where id = 'shelf';

update room set
  name = 'The Co-op',
  what = 'Homeschool and classical co-op chapters, by household.',
  takes = array['did', 'asked', 'hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting'],
  card_noun = 'Meeting',
  requires_next_date = false,
  parish = false,
  sort_order = 4
where id = 'coop';

update room set
  name = 'Reformed Baptist',
  what = 'Reformed Baptist churches that hold the 1689 Confession. Service times, the meal after, the church calendar, and families who need meals this week.',
  takes = array['hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting', 'need'],
  card_noun = 'Service',
  requires_next_date = false,
  parish = true,
  sort_order = 5
where id = 'baptist';

update room set
  name = 'Reformed Presbyterian',
  what = 'Reformed Presbyterian churches that hold the Westminster Standards. Service times, the meal after, the church calendar, and families who need meals this week.',
  takes = array['hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting', 'need'],
  card_noun = 'Service',
  requires_next_date = false,
  parish = true,
  sort_order = 6
where id = 'presbyterian';

update room set
  name = 'Latin Mass',
  what = 'Traditional Latin Mass. Service times, the meal after, the church calendar, and families who need meals this week.',
  takes = array['hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting', 'need'],
  card_noun = 'Service',
  requires_next_date = false,
  parish = true,
  sort_order = 7
where id = 'latin';

update room set
  name = 'Greek Orthodox',
  what = 'Greek Orthodox. Service times, the meal after, the church calendar, and families who need meals this week.',
  takes = array['hosted'],
  steward_takes = array['noted'],
  card_kinds = array['meeting', 'need'],
  card_noun = 'Service',
  requires_next_date = false,
  parish = true,
  sort_order = 8
where id = 'orthodox';

update room set
  name = 'Dispatch',
  what = 'Notices from the stewards: a road closed, a hearing moved. Members read; only stewards post.',
  takes = array[]::text[],
  steward_takes = array['saw'],
  card_kinds = array[]::text[],
  card_noun = 'Meeting',
  requires_next_date = false,
  parish = false,
  sort_order = 9
where id = 'dispatch';

create table if not exists board_post (
  id text primary key,
  room_id text not null references room (id),
  author_user_id text not null references "user" (id) on delete cascade,
  author_name text not null,
  type text not null check (type in ('did', 'asked', 'noted', 'saw', 'hosted')),
  claim text not null check (char_length(claim) between 1 and 600),
  reason text not null default '' check (char_length(reason) <= 600),
  on_date text not null default '',
  next_date text not null default '',
  came text[] not null default '{}',
  named text not null default '',
  parent_id text references board_post (id) on delete cascade,
  closed boolean not null default false,
  mark text check (mark is null or mark in ('sloppy', 'unsupported')),
  removed boolean not null default false,
  card_id text not null default '',
  trade_id text not null default '',
  campaign_id text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists board_post_room_idx on board_post (room_id, created_at desc);
create index if not exists board_post_author_idx on board_post (author_user_id, created_at desc);

create table if not exists board_mark (
  id text primary key,
  post_id text not null references board_post (id) on delete cascade,
  room_id text not null references room (id),
  author_user_id text not null references "user" (id) on delete cascade,
  author_name text not null,
  by_user_id text not null references "user" (id) on delete cascade,
  by_name text not null,
  mark text check (mark is null or mark in ('sloppy', 'unsupported')),
  reason text not null check (char_length(reason) between 8 and 200),
  created_at timestamptz not null default now()
);

create index if not exists board_mark_room_idx on board_mark (room_id, created_at desc);

create table if not exists board_removal (
  id text primary key,
  post_id text not null references board_post (id) on delete cascade,
  author_user_id text not null references "user" (id) on delete cascade,
  author_name text not null,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  reason text not null check (reason in ('threat', 'porn', 'csam')),
  created_at timestamptz not null default now()
);

create index if not exists board_removal_author_idx on board_removal (author_user_id, created_at desc);

create table if not exists board_ban (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  reason text not null check (reason in ('threat', 'porn', 'csam')),
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  strikes integer not null check (strikes >= 1),
  until_at timestamptz not null,
  removal_id text references board_removal (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists board_ban_user_idx on board_ban (user_id, created_at desc);
