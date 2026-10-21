-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0011. This is migration 0011. Do not renumber it.
-- 0006 is reserved by PR #10. 0008 is the board. 0009 and 0010 are unused.
--
-- Towns, ZIP codes, congregations, room requests, and council approvals.
-- Steward and admin grants stay in access_log. A council approval is a
-- one-time label with a reason and a checklist, not a rank.
-- There is no like, no reshare, no score, and no engagement column.

alter table room
  add column if not exists scope_kind text not null default 'topic'
    check (scope_kind in ('topic', 'town', 'congregation', 'region')),
  add column if not exists town_id text not null default '',
  add column if not exists congregation_id text not null default '',
  add column if not exists region_id text not null default '';

alter table room drop constraint if exists room_scope_shape;
alter table room add constraint room_scope_shape check (
  (scope_kind = 'topic' and town_id = '' and congregation_id = '' and region_id = '')
  or (scope_kind = 'town' and town_id <> '' and congregation_id = '' and region_id = '')
  or (scope_kind = 'congregation' and town_id = '' and congregation_id <> '' and region_id = '')
  or (scope_kind = 'region' and town_id = '' and congregation_id = '' and region_id <> '')
);

create table if not exists town (
  id text primary key,
  name text not null,
  state text not null check (state ~ '^[A-Z]{2}$')
);

create table if not exists congregation (
  id text primary key,
  name text not null
);

create table if not exists zip_town (
  zip text primary key check (zip ~ '^[0-9]{5}$'),
  town_id text not null references town (id)
);

-- Newest row for a ZIP wins. An empty town_id clears the ZIP.
create table if not exists zip_correction (
  id text primary key,
  zip text not null check (zip ~ '^[0-9]{5}$'),
  town_id text not null default '',
  name text not null default '',
  state text not null default '',
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  at timestamptz not null default now()
);

create index if not exists zip_correction_zip_idx on zip_correction (zip, at desc, id desc);

create table if not exists member_place (
  user_id text primary key references "user" (id) on delete cascade,
  zip text not null default '' check (zip = '' or zip ~ '^[0-9]{5}$'),
  congregation_id text not null default ''
);

-- A join is a list the member keeps. It is not room_member, which only means
-- the member has stood in the room, and it is not a rank.
create table if not exists room_join (
  user_id text not null references "user" (id) on delete cascade,
  room_id text not null references room (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

create table if not exists room_request (
  id text primary key,
  kind text not null check (kind in ('town', 'congregation', 'region')),
  town_id text not null default '',
  congregation_id text not null default '',
  region_id text not null default '',
  name text not null,
  state text not null default '',
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  at timestamptz not null default now(),
  status text not null check (status in ('open', 'approved', 'refused')),
  decided_by_user_id text references "user" (id) on delete set null,
  decided_by_name text not null default '',
  decided_at timestamptz,
  note text not null default '',
  room_id text references room (id)
);

create unique index if not exists room_request_open_town_idx
  on room_request (town_id) where status = 'open' and kind = 'town';
create unique index if not exists room_request_open_congregation_idx
  on room_request (congregation_id) where status = 'open' and kind = 'congregation';
create unique index if not exists room_request_open_region_idx
  on room_request (region_id) where status = 'open' and kind = 'region';

-- A town can have more than one room (the shop and the town room). A request
-- for a town that already has a town room is refused in the application.
create index if not exists room_town_idx
  on room (town_id) where scope_kind = 'town';
create unique index if not exists room_one_congregation_idx
  on room (congregation_id) where scope_kind = 'congregation';
create unique index if not exists room_one_region_idx
  on room (region_id) where scope_kind = 'region';

alter table board_post
  add column if not exists subject text
    check (subject is null or subject in ('candidate', 'business'));

-- Append-only. The newest row for a post decides. A revoke does not delete
-- the approval. The checklist is the review, and the reason is the log.
create table if not exists council_approval (
  id text primary key,
  post_id text not null references board_post (id) on delete cascade,
  reason text not null check (char_length(reason) between 8 and 200),
  checklist text[] not null check (cardinality(checklist) >= 1),
  by_user_id text references "user" (id) on delete set null,
  by_name text not null,
  action text not null check (action in ('approve', 'revoke')),
  at timestamptz not null default now()
);

create index if not exists council_approval_post_idx
  on council_approval (post_id, at desc, id desc);

insert into town (id, name, state) values
  ('brandon-fl', 'Brandon', 'FL'),
  ('riverview-fl', 'Riverview', 'FL'),
  ('valrico-fl', 'Valrico', 'FL'),
  ('tampa-fl', 'Tampa', 'FL')
on conflict (id) do nothing;

insert into congregation (id, name) values
  ('epiphany', 'Epiphany of Our Lord'),
  ('grace', 'Grace Bible Church of Brandon'),
  ('redeemer', 'Redeemer Presbyterian'),
  ('st-john', 'St. John the Baptist')
on conflict (id) do nothing;

insert into zip_town (zip, town_id) values
  ('33510', 'brandon-fl'),
  ('33511', 'brandon-fl'),
  ('33569', 'riverview-fl'),
  ('33578', 'riverview-fl'),
  ('33579', 'riverview-fl'),
  ('33594', 'valrico-fl'),
  ('33596', 'valrico-fl'),
  ('33602', 'tampa-fl'),
  ('33603', 'tampa-fl'),
  ('33604', 'tampa-fl'),
  ('33605', 'tampa-fl'),
  ('33606', 'tampa-fl'),
  ('33607', 'tampa-fl'),
  ('33609', 'tampa-fl'),
  ('33611', 'tampa-fl'),
  ('33612', 'tampa-fl'),
  ('33616', 'tampa-fl'),
  ('33620', 'tampa-fl'),
  ('33621', 'tampa-fl'),
  ('33629', 'tampa-fl'),
  ('33647', 'tampa-fl')
on conflict (zip) do nothing;

insert into room (
  id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish,
  sort_order, scope_kind, town_id, congregation_id, region_id
) values
  (
    'rv-shop',
    'Shop nights',
    'Hands-on nights in Riverview. The bench, the radio net, and businesses members have vouched for.',
    array['did', 'asked', 'hosted'],
    array['noted'],
    array['meeting', 'trade'],
    'Meeting',
    false,
    false,
    20,
    'town',
    'riverview-fl',
    '',
    ''
  ),
  (
    'rv-town',
    'Riverview town room',
    'Meetings and local notices for Riverview.',
    array['did', 'asked', 'hosted'],
    array['noted'],
    array['meeting'],
    'Meeting',
    false,
    false,
    21,
    'town',
    'riverview-fl',
    '',
    ''
  ),
  (
    'brandon-town',
    'Brandon town room',
    'Meetings and local notices for Brandon.',
    array['did', 'asked', 'hosted'],
    array['noted'],
    array['meeting'],
    'Meeting',
    false,
    false,
    22,
    'town',
    'brandon-fl',
    '',
    ''
  ),
  (
    'valrico-town',
    'Valrico town room',
    'Meetings and local notices for Valrico.',
    array['did', 'asked', 'hosted'],
    array['noted'],
    array['meeting'],
    'Meeting',
    false,
    false,
    23,
    'town',
    'valrico-fl',
    '',
    ''
  ),
  (
    'tampa-town',
    'Tampa town room',
    'Meetings and local notices for Tampa.',
    array['did', 'asked', 'hosted'],
    array['noted'],
    array['meeting'],
    'Meeting',
    false,
    false,
    24,
    'town',
    'tampa-fl',
    '',
    ''
  ),
  (
    'cong-epiphany',
    'Epiphany of Our Lord',
    'Service times, the meal after, and families who need meals this week.',
    array['hosted'],
    array['noted'],
    array['meeting', 'need'],
    'Service',
    false,
    true,
    30,
    'congregation',
    '',
    'epiphany',
    ''
  ),
  (
    'cong-grace',
    'Grace Bible Church of Brandon',
    'Service times, the meal after, and families who need meals this week.',
    array['hosted'],
    array['noted'],
    array['meeting', 'need'],
    'Service',
    false,
    true,
    31,
    'congregation',
    '',
    'grace',
    ''
  ),
  (
    'cong-redeemer',
    'Redeemer Presbyterian',
    'Service times, the meal after, and families who need meals this week.',
    array['hosted'],
    array['noted'],
    array['meeting', 'need'],
    'Service',
    false,
    true,
    32,
    'congregation',
    '',
    'redeemer',
    ''
  ),
  (
    'cong-st-john',
    'St. John the Baptist',
    'Service times, the meal after, and families who need meals this week.',
    array['hosted'],
    array['noted'],
    array['meeting', 'need'],
    'Service',
    false,
    true,
    33,
    'congregation',
    '',
    'st-john',
    ''
  ),
  (
    'region-hillsborough',
    'Hillsborough County',
    'County hearings, bills, and candidate events, labeled as such.',
    array['did', 'asked', 'hosted'],
    array['noted'],
    array['meeting', 'candidate'],
    'Meeting',
    false,
    false,
    40,
    'region',
    '',
    '',
    'hillsborough'
  )
on conflict (id) do nothing;

-- Account deletion for the tables this migration adds. This is not
-- anonymize_board_user. Migrations 0012 and 0013 replace that function, and
-- the last one applied would otherwise drop these updates. The town a member
-- corrected is stored on zip_correction, with the council approval and the
-- room request.
create or replace function anonymize_places_user() returns trigger
language plpgsql
as $$
begin
  update zip_correction
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update room_request
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  update room_request
    set decided_by_user_id = null, decided_by_name = 'Removed member'
    where decided_by_user_id = old.id;
  update council_approval
    set by_user_id = null, by_name = 'Removed member'
    where by_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_places_user on "user";
create trigger anonymize_places_user
  before delete on "user"
  for each row execute function anonymize_places_user();
