-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
-- Take a backup before applying this to production.
--
-- Numbered 0051. PR #111 holds 0046, PR #124 holds 0048, and PR #126 holds
-- 0049 and 0050. None of those touch what this file touches.
--
-- A county is the top level. Every room and every group has exactly one county.
-- Hillsborough, Polk, Manatee, and Pinellas are the first four.
-- A county is a place to look, not a wall: nothing here changes who may read
-- or join a room. That is still room_join, room_member, and the audience.
-- members.home_county is the county a member chose. It stays null until they
-- choose, and the app asks once. Nothing here guesses it.
-- Nothing here is a like, a reshare, a score, or a rank.

create table if not exists county (
  id text primary key,
  name text not null,
  state text not null default 'FL',
  sort_order integer not null,
  constraint county_id_check check (id ~ '^[a-z]+(-[a-z]+)*$' and char_length(id) <= 32),
  constraint county_name_check check (char_length(name) between 1 and 80),
  constraint county_state_check check (state ~ '^[A-Z]{2}$')
);

insert into county (id, name, state, sort_order) values
  ('hillsborough', 'Hillsborough', 'FL', 0),
  ('polk', 'Polk', 'FL', 1),
  ('manatee', 'Manatee', 'FL', 2),
  ('pinellas', 'Pinellas', 'FL', 3)
on conflict (id) do nothing;

-- The default stands in only for a process still running the code from before
-- this file. The API names a county on every room it adds.
alter table room add column if not exists county_id text not null default 'hillsborough';
alter table room drop constraint if exists room_county_id_fkey;
alter table room
  add constraint room_county_id_fkey foreign key (county_id) references county (id);
create index if not exists room_county_idx on room (county_id);

alter table theme_group add column if not exists county_id text not null default 'hillsborough';
alter table theme_group drop constraint if exists theme_group_county_id_fkey;
alter table theme_group
  add constraint theme_group_county_id_fkey foreign key (county_id) references county (id);
create index if not exists theme_group_county_idx on theme_group (county_id);

-- A town, congregation, or wider-area request is for one county.
alter table room_request add column if not exists county_id text not null default 'hillsborough';
alter table room_request drop constraint if exists room_request_county_id_fkey;
alter table room_request
  add constraint room_request_county_id_fkey foreign key (county_id) references county (id);

alter table members add column if not exists home_county text;
alter table members drop constraint if exists members_home_county_fkey;
alter table members
  add constraint members_home_county_fkey foreign key (home_county) references county (id);

-- Rooms: an imported listing that names one of the four keeps that county.
-- Everything else stays on the default, Hillsborough, as agreed.
update room
set county_id = lower(split_part(btrim(county), ' ', 1))
where lower(split_part(btrim(county), ' ', 1)) in ('hillsborough', 'polk', 'manatee', 'pinellas');

-- Groups: a group approved from a room sits with that room. The five seed
-- groups have no source room and stay in Hillsborough.
update theme_group g
set county_id = r.county_id
from room r
where r.id = g.source_room_id;

-- Members: a county already saved on the profile is kept. Everyone else is
-- asked at next sign-in. Joined rooms do not change.
update members
set home_county = location_county
where home_county is null
  and location_county in ('hillsborough', 'manatee', 'pinellas');

-- Polk joins the town list. This replaces the check from 0024.
alter table members drop constraint if exists members_location_check;
alter table members add constraint members_location_check
  check (
    (location_town = '' and location_county = '')
    or (location_town = 'elsewhere' and location_county = '')
    or (location_county = 'hillsborough' and location_town in (
      'tampa', 'temple-terrace', 'plant-city', 'brandon', 'riverview', 'valrico',
      'seffner', 'lutz', 'ruskin', 'apollo-beach', 'sun-city-center', 'wimauma',
      'gibsonton', 'thonotosassa', 'fishhawk', 'town-n-country', 'westchase',
      'carrollwood', 'citrus-park', 'dover', 'lithia', 'mango', 'odessa'
    ))
    or (location_county = 'polk' and location_town in (
      'lakeland', 'winter-haven', 'bartow', 'auburndale', 'haines-city', 'lake-wales',
      'davenport', 'mulberry', 'fort-meade', 'frostproof', 'dundee', 'eagle-lake',
      'lake-alfred', 'lake-hamilton', 'polk-city', 'highland-park', 'hillcrest-heights'
    ))
    or (location_county = 'manatee' and location_town in (
      'bradenton', 'palmetto', 'anna-maria', 'holmes-beach', 'bradenton-beach',
      'ellenton', 'parrish', 'lakewood-ranch', 'myakka-city', 'cortez',
      'longboat-key', 'samoset', 'bayshore-gardens'
    ))
    or (location_county = 'pinellas' and location_town in (
      'st-petersburg', 'clearwater', 'largo', 'pinellas-park', 'dunedin',
      'safety-harbor', 'tarpon-springs', 'oldsmar', 'seminole', 'gulfport',
      'kenneth-city', 'belleair', 'belleair-beach', 'belleair-bluffs',
      'st-pete-beach', 'treasure-island', 'indian-rocks-beach', 'indian-shores',
      'madeira-beach', 'redington-beach', 'redington-shores', 'north-redington-beach',
      'south-pasadena', 'palm-harbor', 'east-lake', 'lealman', 'tierra-verde'
    ))
  );

-- Polk, Manatee, and Pinellas each open with their own County room. Admins run
-- them until a steward is named. The existing County room stays Hillsborough's.
insert into room (
  id, name, what, takes, steward_takes, card_kinds, card_noun, requires_next_date, parish,
  sort_order, county_id
) values
  (
    'county-polk',
    'The County',
    $text$Polk County hearings and bills. Candidate events are allowed, labeled as such.$text$,
    array['shared', 'did', 'asked', 'hosted'],
    array['noted'],
    array['meeting', 'candidate'],
    'Meeting',
    false,
    false,
    30,
    'polk'
  ),
  (
    'county-manatee',
    'The County',
    $text$Manatee County hearings and bills. Candidate events are allowed, labeled as such.$text$,
    array['shared', 'did', 'asked', 'hosted'],
    array['noted'],
    array['meeting', 'candidate'],
    'Meeting',
    false,
    false,
    31,
    'manatee'
  ),
  (
    'county-pinellas',
    'The County',
    $text$Pinellas County hearings and bills. Candidate events are allowed, labeled as such.$text$,
    array['shared', 'did', 'asked', 'hosted'],
    array['noted'],
    array['meeting', 'candidate'],
    'Meeting',
    false,
    false,
    32,
    'pinellas'
  )
on conflict (id) do nothing;

insert into room_categories (room_id, category_id)
select id, 'county' from room
where id in ('county-polk', 'county-manatee', 'county-pinellas')
on conflict do nothing;
