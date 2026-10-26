-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0024. 0020 is unclaimed rooms, 0021 is categories, and 0022 is
-- stats. Those files belong to other pull requests and are not in this
-- directory. 0023 is reserved for MFA. This file does not use that number.
-- 0019 is the members row and room audience.
--
-- Display name is added nullable, copied from the account name, then set
-- NOT NULL. Bio, birthdate, town, county, church, and interests sit on the
-- same row. Birthdate is stored here. No endpoint and no stats CSV selects
-- it for a response. Age is computed when a profile is read.
-- member_link holds https links. profile_visibility holds one level per
-- field. The default, when a field has no row, is every member.
-- profile_anonymous is the hook for permissions 0025. Nothing in this file
-- sets it true, and the API ignores it until that permission lands.
-- The same is true of the admins visibility level: the column allows it,
-- and the write path refuses it until 0025.
-- A profile picture uses media_object with scope profile. The bytes stay
-- in object storage. This file does not replace an anonymize function.
-- Deleting the account still drops the members row, and the new tables
-- follow it. An admin birthdate change is a gender_audit row
-- (set-birthdate or change-birthdate). The existing account-delete
-- trigger already clears that detail. This file adds no engagement column.

alter table members add column if not exists display_name text;

update members as m
set display_name = left(trim(u.name), 80)
from "user" as u
where u.id = m.user_id
  and (m.display_name is null or trim(m.display_name) = '')
  and trim(u.name) <> '';

update members
set display_name = 'Member'
where display_name is null or trim(display_name) = '';

alter table members alter column display_name set not null;

alter table members drop constraint if exists members_display_name_check;
alter table members add constraint members_display_name_check
  check (char_length(trim(display_name)) between 1 and 80);

alter table members add column if not exists bio text not null default '';
alter table members drop constraint if exists members_bio_check;
alter table members add constraint members_bio_check
  check (char_length(bio) <= 600);

alter table members add column if not exists birthdate date;
alter table members drop constraint if exists members_birthdate_check;
alter table members add constraint members_birthdate_check
  check (birthdate is null or birthdate >= date '1900-01-01');

alter table members add column if not exists location_town text not null default '';
alter table members add column if not exists location_county text not null default '';
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

alter table members add column if not exists church text not null default '';
alter table members drop constraint if exists members_church_check;
alter table members add constraint members_church_check
  check (char_length(church) <= 120);

alter table members add column if not exists interests text[] not null default '{}';
alter table members drop constraint if exists members_interests_check;
alter table members add constraint members_interests_check
  check (
    cardinality(interests) <= 12
    and interests <@ array[
      'woodworking', 'gardening', 'brewing', 'distilling', 'books', 'radio',
      'lifting', 'cooking', 'hunting', 'fishing', 'trades', 'history', 'music',
      'homeschool'
    ]::text[]
  );

alter table members add column if not exists onboarded_at timestamptz;

-- Permissions 0025 reads this. No statement here sets it true.
alter table members add column if not exists profile_anonymous boolean not null default false;

alter table members add column if not exists photo_media_id text;
alter table members drop constraint if exists members_photo_media_id_fkey;
alter table members
  add constraint members_photo_media_id_fkey
  foreign key (photo_media_id) references media_object (id) on delete set null;

create table if not exists member_link (
  user_id text not null references members (user_id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  url text not null check (
    char_length(url) between 8 and 500 and url ~ '^https://'
  ),
  label text not null default '' check (char_length(label) <= 80),
  primary key (user_id, position)
);

create table if not exists profile_visibility (
  user_id text not null references members (user_id) on delete cascade,
  field text not null check (field in (
    'photo', 'bio', 'gender', 'age', 'location', 'church', 'interests', 'links'
  )),
  level text not null check (level in ('members', 'shared', 'private', 'admins')),
  primary key (user_id, field)
);

-- Profile pictures are a third media scope. Room and message rows stay as they are.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'media_object'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%scope%'
  loop
    execute format('alter table media_object drop constraint %I', constraint_name);
  end loop;
end $$;

alter table media_object add constraint media_object_scope_check
  check (scope in ('room', 'dm', 'profile'));

alter table media_object add constraint media_scope_shape check (
  (scope = 'room' and encryption = 'server-processed' and room_id <> '' and post_id <> ''
    and peer_user_id is null and key_envelope = '')
  or
  (scope = 'dm' and encryption = 'client-e2e' and room_id = '' and post_id = ''
    and length(key_envelope) between 1 and 4096
    and (peer_user_id is not null or deleted_at is not null or owner_user_id is not null))
  or
  (scope = 'profile' and encryption = 'server-processed' and kind = 'image'
    and room_id = '' and post_id = '' and peer_user_id is null and key_envelope = ''
    and content_type in ('image/jpeg', 'image/png', 'image/webp')
    and byte_size <= 5242880 and duration_ms is null)
);

alter table gender_audit drop constraint if exists gender_audit_action_check;
alter table gender_audit add constraint gender_audit_action_check check (
  action in (
    'set-gender',
    'change-gender',
    'confirm-gender',
    'set-audience',
    'audience-override',
    'set-birthdate',
    'change-birthdate'
  )
);
