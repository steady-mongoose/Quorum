-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0021. 0019 and 0020 are reserved by parallel pull requests.
-- Do not renumber this file.
--
-- Categories an admin can edit. The seed order is fixed:
-- Churches, Discussion, Men only, Women only, Business & Trades, Civic, County.
-- Men only and Women only are where a room is listed. This file does not
-- record who may enter. Audience is a later migration.
--
-- Every room has one category. Rooms this file does not name, and that are
-- not a town, congregation, or region, go to Uncategorized. Browse hides
-- that category until an admin or that room's steward moves them.
--
-- Backfill, from src/lib/board/categories.ts. Each update fills a null
-- category only, so a second run does not put a later edit back.
--   Churches: baptist, presbyterian, latin, orthodox,
--     cong-epiphany, cong-grace, cong-redeemer, cong-st-john
--   Discussion: question, shelf, coop
--   Business & Trades: shop, rv-shop
--   Civic: dispatch, rv-town, brandon-town, valrico-town, tampa-town
--   County: county, region-hillsborough
-- Then, still only where the category is null:
--   town → Civic, congregation → Churches, region → County.
-- Whatever is still empty goes to Uncategorized.
-- Men only and Women only have no rooms.

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
  ('discussion', 'Discussion', 'Questions, the shelf, and the co-op.', 1),
  ('men', 'Men only', 'Rooms listed for men.', 2),
  ('women', 'Women only', 'Rooms listed for women.', 3),
  ('business-trades', 'Business & Trades', 'Shops and the trades.', 4),
  ('civic', 'Civic', 'Town rooms and dispatch.', 5),
  ('county', 'County', 'The county and its regions.', 6),
  ('uncategorized', 'Uncategorized', 'Rooms waiting for a category.', 1000)
on conflict (slug) do nothing;

alter table room add column if not exists category_id text;
alter table room add column if not exists pin_order integer;
alter table room drop constraint if exists room_pin_order_check;
alter table room
  add constraint room_pin_order_check check (pin_order is null or pin_order between 0 and 10000);

update room set category_id = 'churches'
where category_id is null
  and id in (
    'baptist', 'presbyterian', 'latin', 'orthodox',
    'cong-epiphany', 'cong-grace', 'cong-redeemer', 'cong-st-john'
  );

update room set category_id = 'discussion'
where category_id is null
  and id in ('question', 'shelf', 'coop');

update room set category_id = 'business-trades'
where category_id is null
  and id in ('shop', 'rv-shop');

update room set category_id = 'civic'
where category_id is null
  and id in ('dispatch', 'rv-town', 'brandon-town', 'valrico-town', 'tampa-town');

update room set category_id = 'county'
where category_id is null
  and id in ('county', 'region-hillsborough');

update room set category_id = 'civic'
where category_id is null and scope_kind = 'town';

update room set category_id = 'churches'
where category_id is null and scope_kind = 'congregation';

update room set category_id = 'county'
where category_id is null and scope_kind = 'region';

update room set category_id = 'uncategorized'
where category_id is null or category_id = '';

alter table room alter column category_id set default 'uncategorized';
alter table room alter column category_id set not null;

alter table room drop constraint if exists room_category_id_fkey;
alter table room
  add constraint room_category_id_fkey
  foreign key (category_id) references categories (slug);

create index if not exists room_category_idx on room (category_id);
