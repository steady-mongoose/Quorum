-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0022. 0019, 0020, and 0021 are reserved by parallel pull requests.
--
-- One row per member per day, and the rolled-up counts an admin can read.
-- No address is stored. Message tables are not used. A count under 5 is
-- stored exactly and hidden when it is shown.

create table if not exists member_active_days (
  member_id text not null references "user" (id) on delete cascade,
  date date not null,
  primary key (member_id, date)
);

create index if not exists member_active_days_date_idx on member_active_days (date);

create table if not exists stats_daily (
  date date not null,
  metric text not null check (metric ~ '^[a-z][a-z0-9_]{0,40}$'),
  dimension text not null default '' check (char_length(dimension) <= 80),
  count integer not null check (count >= 0),
  primary key (date, metric, dimension)
);

create index if not exists stats_daily_metric_idx on stats_daily (metric, date);
