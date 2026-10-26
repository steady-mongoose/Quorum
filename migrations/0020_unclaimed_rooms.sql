-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0020. 0019 stays reserved for audience rooms (PR #49).
-- 0006 has already landed. This file does not create or replace a function
-- that another migration owns.
--
-- A seeded listing is a room with status draft or unclaimed. Existing rooms
-- stay active. Members do not see a draft or an unclaimed room. A claim is
-- one row. Nothing here is a like, a reshare, a score, or a rank.

alter table room
  add column if not exists status text not null default 'active',
  add column if not exists seeded_by text references "user" (id) on delete set null,
  add column if not exists source_url text not null default '',
  add column if not exists town_name text not null default '',
  add column if not exists county text not null default '',
  add column if not exists host_user_id text references "user" (id) on delete set null;

-- Category is not a free-text column on room. PR #51 adds categories and
-- room.category_id. A seed file still names a category; that name is not
-- stored until category_id exists.

alter table room drop constraint if exists room_status_check;
alter table room add constraint room_status_check
  check (status in ('draft', 'unclaimed', 'active'));

alter table room drop constraint if exists room_source_url_len;
alter table room add constraint room_source_url_len
  check (char_length(source_url) <= 400);

alter table room drop constraint if exists room_town_name_len;
alter table room add constraint room_town_name_len
  check (char_length(town_name) <= 80);

alter table room drop constraint if exists room_county_len;
alter table room add constraint room_county_len
  check (char_length(county) <= 80);

-- One request from one member for one room. The state is the record.
-- claimant and reviewer are user ids. A removed account keeps the row.
create table if not exists claim_request (
  id text primary key,
  room_id text not null references room (id) on delete cascade,
  claimant text references "user" (id) on delete set null,
  claimant_name text not null default '',
  method text not null check (method in ('domain_email', 'site_code', 'steward_review')),
  evidence text not null default '' check (char_length(evidence) <= 4000),
  state text not null check (state in ('pending', 'approved', 'rejected', 'expired')),
  reviewer text references "user" (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null
);

create index if not exists claim_request_room_idx
  on claim_request (room_id, created_at asc, id asc);

create index if not exists claim_request_state_idx
  on claim_request (state, created_at asc, id asc);

create unique index if not exists claim_request_one_pending
  on claim_request (room_id, claimant)
  where state = 'pending' and claimant is not null;

-- Account deletion for this migration only. This is not anonymize_board_user.
create or replace function anonymize_claim_user() returns trigger
language plpgsql
as $$
begin
  update claim_request set claimant = null where claimant = old.id;
  update claim_request set reviewer = null where reviewer = old.id;
  update room set seeded_by = null where seeded_by = old.id;
  update room set host_user_id = null where host_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists anonymize_claim_user on "user";
create trigger anonymize_claim_user
  before delete on "user"
  for each row execute function anonymize_claim_user();
