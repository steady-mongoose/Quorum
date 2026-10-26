-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0021. 0019 and 0020 are reserved by parallel pull requests.
-- Do not renumber this file.
--
-- Categories an admin can edit. The seed order is fixed:
-- Churches, Philosophy & Discussion, Men's, Women's, Businesses, Civic, County.
-- Men's and Women's are where a room is listed. This file does not record
-- who may enter. Audience is a later migration.
--
-- A room belongs to one or more categories through room_categories.
-- Deleting a room removes its links. Deleting a category that still has a
-- room is refused. The API refuses to clear a room's last link.
--
-- Rooms this file does not name, and that are not a town, congregation, or
-- region, go to Uncategorized. Browse hides that category until an admin or
-- that room's steward files them.
--
-- Backfill, from src/lib/board/categories.ts. Each insert runs only for a
-- room that has no links yet, so a second run does not put a later edit back.
--   Churches: baptist, presbyterian, latin, orthodox,
--     cong-epiphany, cong-grace, cong-redeemer, cong-st-john
--   Philosophy & Discussion: question, shelf, coop
--   Businesses: shop, rv-shop
--   Civic: dispatch, rv-town, brandon-town, valrico-town, tampa-town
--   County: county, region-hillsborough
-- Then, still only where the room has no links:
--   town → Civic, congregation → Churches, region → County.
-- Whatever still has no link goes to Uncategorized.
-- Men's and Women's have no rooms.

create table if not exists categories (
  slug text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null,
  constraint categories_slug_check check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 32
  ),
  constraint categories_name_check check (char_length(name) between 1 and 80),
  constraint categories_description_check check (char_length(description) <= 200),
  constraint categories_sort_check check (sort_order between 0 and 10000)
);

alter table categories add column if not exists description text not null default '';
alter table categories drop constraint if exists categories_description_check;
alter table categories
  add constraint categories_description_check check (char_length(description) <= 200);

insert into categories (slug, name, description, sort_order) values
  ('churches', 'Churches', 'Parish and congregation rooms.', 0),
  ('discussion', 'Philosophy & Discussion', 'Questions, the shelf, and the co-op.', 1),
  ('men', 'Men''s', 'Rooms listed for men.', 2),
  ('women', 'Women''s', 'Rooms listed for women.', 3),
  ('business-trades', 'Businesses', 'Shops and the trades.', 4),
  ('civic', 'Civic', 'Town rooms and dispatch.', 5),
  ('county', 'County', 'The county and its regions.', 6),
  ('uncategorized', 'Uncategorized', 'Rooms waiting for a category.', 1000)
on conflict (slug) do nothing;

alter table room add column if not exists pin_order integer;
alter table room drop constraint if exists room_pin_order_check;
alter table room
  add constraint room_pin_order_check check (pin_order is null or pin_order between 0 and 10000);

alter table room drop constraint if exists room_category_id_fkey;
drop index if exists room_category_idx;
alter table room drop column if exists category_id;

create table if not exists room_categories (
  room_id text not null references room (id) on delete cascade,
  category_id text not null references categories (slug) on delete restrict,
  primary key (room_id, category_id)
);

insert into room_categories (room_id, category_id)
select room.id, 'churches'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.id in (
  'baptist', 'presbyterian', 'latin', 'orthodox',
  'cong-epiphany', 'cong-grace', 'cong-redeemer', 'cong-st-john'
);

insert into room_categories (room_id, category_id)
select room.id, 'discussion'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.id in ('question', 'shelf', 'coop');

insert into room_categories (room_id, category_id)
select room.id, 'business-trades'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.id in ('shop', 'rv-shop');

insert into room_categories (room_id, category_id)
select room.id, 'civic'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.id in ('dispatch', 'rv-town', 'brandon-town', 'valrico-town', 'tampa-town');

insert into room_categories (room_id, category_id)
select room.id, 'county'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.id in ('county', 'region-hillsborough');

insert into room_categories (room_id, category_id)
select room.id, 'civic'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.scope_kind = 'town';

insert into room_categories (room_id, category_id)
select room.id, 'churches'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.scope_kind = 'congregation';

insert into room_categories (room_id, category_id)
select room.id, 'county'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
)
and room.scope_kind = 'region';

insert into room_categories (room_id, category_id)
select room.id, 'uncategorized'
from room
where not exists (
  select 1 from room_categories rc where rc.room_id = room.id
);
