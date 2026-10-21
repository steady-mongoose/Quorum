-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0008. 0006 is reserved by PR #10.
--
-- Rooms, posts, steward marks, hard removals, and bans. Members read the same
-- rows. Marks stay on the post; they do not hide it. Nothing here is a like,
-- a reshare, a score, or a rank. Posts are newest first. A mark does not move one.

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

-- Insert a seeded room when it is missing. Fill a blank row left by 0004.
-- Leave a room alone once it has a name, so a later apply does not undo an edit.
insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'county',
  'The County',
  $text$County hearings, bills, and the week's coordinated phone call to one official. Candidate events are allowed, labeled as such.$text$,
  array['did', 'asked', 'hosted'],
  array['noted'],
  array['meeting', 'candidate'],
  'Meeting',
  false,
  false,
  0
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'question',
  'Debate Night',
  $text$A debate once a month at a brewery or a hall. One question, two sides, a Christian host, anyone welcome. Afterwards the host writes up how it went and names next month's question.$text$,
  array['did', 'asked', 'hosted'],
  array['noted'],
  array['meeting'],
  'Debate',
  true,
  false,
  1
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'shop',
  'The Shop',
  'Hands-on nights: woodworking, the radio net, the gym hour. Also the directory of tradesmen that members have vouched for.',
  array['did', 'asked', 'hosted'],
  array['noted'],
  array['meeting', 'trade'],
  'Meeting',
  true,
  false,
  2
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'shelf',
  'Literary Society',
  'A reading group. One book at a time, a few chapters between meetings, talked through around a table. The host says what to read before next time.',
  array['did', 'asked', 'hosted'],
  array['noted'],
  array['meeting'],
  'Reading',
  true,
  false,
  3
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'coop',
  'The Co-op',
  'Homeschool and classical co-op chapters, by household.',
  array['did', 'asked', 'hosted'],
  array['noted'],
  array['meeting'],
  'Meeting',
  false,
  false,
  4
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'baptist',
  'Reformed Baptist',
  'Reformed Baptist churches that hold the 1689 Confession. Service times, the meal after, the church calendar, and families who need meals this week.',
  array['hosted'],
  array['noted'],
  array['meeting', 'need'],
  'Service',
  false,
  true,
  5
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'presbyterian',
  'Reformed Presbyterian',
  'Reformed Presbyterian churches that hold the Westminster Standards. Service times, the meal after, the church calendar, and families who need meals this week.',
  array['hosted'],
  array['noted'],
  array['meeting', 'need'],
  'Service',
  false,
  true,
  6
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'latin',
  'Latin Mass',
  'Traditional Latin Mass. Service times, the meal after, the church calendar, and families who need meals this week.',
  array['hosted'],
  array['noted'],
  array['meeting', 'need'],
  'Service',
  false,
  true,
  7
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'orthodox',
  'Greek Orthodox',
  'Greek Orthodox. Service times, the meal after, the church calendar, and families who need meals this week.',
  array['hosted'],
  array['noted'],
  array['meeting', 'need'],
  'Service',
  false,
  true,
  8
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

insert into room (id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish, sort_order)
values (
  'dispatch',
  'Dispatch',
  'Notices from the stewards: a road closed, a hearing moved. Members read; only stewards post.',
  array[]::text[],
  array['saw'],
  array[]::text[],
  'Meeting',
  false,
  false,
  9
)
on conflict (id) do update set
  name = excluded.name,
  what = excluded.what,
  takes = excluded.takes,
  steward_takes = excluded.steward_takes,
  card_kinds = excluded.card_kinds,
  card_noun = excluded.card_noun,
  requires_next_date = excluded.requires_next_date,
  parish = excluded.parish,
  sort_order = excluded.sort_order
where room.name = '';

create table if not exists board_post (
  id text primary key,
  room_id text not null references room (id),
  author_user_id text references "user" (id) on delete set null,
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
  author_user_id text references "user" (id) on delete set null,
  author_name text not null,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  mark text check (mark is null or mark in ('sloppy', 'unsupported')),
  reason text not null check (char_length(reason) between 8 and 200),
  created_at timestamptz not null default now()
);

create index if not exists board_mark_room_idx on board_mark (room_id, created_at desc);

create table if not exists board_removal (
  id text primary key,
  post_id text not null references board_post (id) on delete cascade,
  author_user_id text references "user" (id) on delete set null,
  author_name text not null,
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  reason text not null check (reason in ('threat', 'porn', 'csam')),
  created_at timestamptz not null default now()
);

create index if not exists board_removal_author_idx on board_removal (author_user_id, created_at desc);

create table if not exists board_ban (
  id text primary key,
  user_id text references "user" (id) on delete set null,
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

create index if not exists board_post_parent_idx on board_post (parent_id);
create index if not exists board_post_room_page_idx on board_post (room_id, created_at desc, id desc);
create index if not exists board_mark_post_idx on board_mark (post_id);
create index if not exists board_removal_post_idx on board_removal (post_id);

-- Deleting an account keeps the moderation record and drops the name.
create or replace function anonymize_board_user() returns trigger
language plpgsql
as $$
begin
  update board_post
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update board_mark
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update board_mark
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update board_removal
    set author_user_id = null, author_name = 'Removed member'
    where author_user_id = old.id;
  update board_removal
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update board_ban
    set user_id = null, name = 'Removed member'
    where user_id = old.id;
  update board_ban
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_board_user on "user";
create trigger anonymize_board_user
  before delete on "user"
  for each row execute function anonymize_board_user();
