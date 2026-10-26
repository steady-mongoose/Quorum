-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0021. 0019 and 0020 are reserved by parallel pull requests.
-- Do not renumber this file.
--
-- Categories a steward can edit. The seed order is fixed:
-- Churches, Discussion, Men, Women, Business & Trades, Civic, County.
-- Men and Women are labels only. This file does not record who may enter
-- them. Audience is a later migration.
--
-- Every room has one category. Rooms this file does not name go to
-- Uncategorized, which Browse hides until a steward moves them.
--
-- Backfill, from src/lib/board/categories.ts:
--   Churches: baptist, presbyterian, latin, orthodox,
--     cong-epiphany, cong-grace, cong-redeemer, cong-st-john
--   Discussion: question, shelf, coop
--   Business & Trades: shop, rv-shop
--   Civic: dispatch, rv-town, brandon-town, valrico-town, tampa-town
--   County: county, region-hillsborough
--   Men and Women: no rooms
-- A second run is safe. It does not put a steward's later edit back.

create table if not exists categories (
  slug text primary key,
  name text not null,
  sort_order integer not null,
  constraint categories_slug_check check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 1 and 32
  ),
  constraint categories_name_check check (char_length(name) between 1 and 80),
  constraint categories_sort_check check (sort_order between 0 and 10000)
);

insert into categories (slug, name, sort_order) values
  ('churches', 'Churches', 0),
  ('discussion', 'Discussion', 1),
  ('men', 'Men', 2),
  ('women', 'Women', 3),
  ('business-trades', 'Business & Trades', 4),
  ('civic', 'Civic', 5),
  ('county', 'County', 6),
  ('uncategorized', 'Uncategorized', 1000)
on conflict (slug) do nothing;

alter table room add column if not exists category_id text;

update room set category_id = 'churches'
where id in (
  'baptist', 'presbyterian', 'latin', 'orthodox',
  'cong-epiphany', 'cong-grace', 'cong-redeemer', 'cong-st-john'
);

update room set category_id = 'discussion'
where id in ('question', 'shelf', 'coop');

update room set category_id = 'business-trades'
where id in ('shop', 'rv-shop');

update room set category_id = 'civic'
where id in ('dispatch', 'rv-town', 'brandon-town', 'valrico-town', 'tampa-town');

update room set category_id = 'county'
where id in ('county', 'region-hillsborough');

update room set category_id = 'uncategorized'
where category_id is null or category_id = '';

alter table room alter column category_id set default 'uncategorized';
alter table room alter column category_id set not null;

alter table room drop constraint if exists room_category_id_fkey;
alter table room
  add constraint room_category_id_fkey
  foreign key (category_id) references categories (slug);

create index if not exists room_category_idx on room (category_id);
