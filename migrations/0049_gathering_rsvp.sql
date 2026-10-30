-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0049. 0046, 0047, and 0048 are reserved by other pull requests.
-- 0018 (public_gathering) is already on production. This file only adds a
-- table next to it. It does not change public_gathering or replace a function.
--
-- Deploy order: apply this file first, then deploy the API that reads it.
-- The API from before this file never touches gathering_rsvp, so applying it
-- early is safe. The new API answers 503 on the RSVP routes until it exists.
--
-- Rollback: `drop table if exists gathering_rsvp;` after deploying the API
-- from before this file. RSVPs saved on the server are lost; each browser
-- still holds its own, and the one-time move does not run twice.
--
-- RSVPs and attendance, stored on the server (Josh, Oct 29, freeze exception).
-- One row per gathering and member. `going` is "I'll be there" for the next
-- date. `attended` is "I've been". They are separate because someone who has
-- been can say they are coming again. An admin reads every row; anyone else
-- reads only their own (enforced in server/board/rsvp.ts). Nothing here is a
-- count, a like, a score, or a rank, and no column totals anything.
--
-- The key is public_gathering.id (a UUID). On a signed-in board every card
-- is a public_gathering row, so the card id is the gathering id. Sample
-- cards that only live in a browser (ids like "brief") have no row and
-- cannot hold a server RSVP. Deleting a gathering or an account deletes its
-- RSVPs. A second run is safe.

create table if not exists gathering_rsvp (
  gathering_id text not null references public_gathering (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  going boolean not null default false,
  attended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gathering_rsvp_pkey primary key (gathering_id, user_id)
);

alter table gathering_rsvp add column if not exists going boolean not null default false;
alter table gathering_rsvp add column if not exists attended boolean not null default false;
alter table gathering_rsvp add column if not exists updated_at timestamptz not null default now();

-- A row says something. Clearing both is a delete, not an empty row.
alter table gathering_rsvp drop constraint if exists gathering_rsvp_says_check;
alter table gathering_rsvp add constraint gathering_rsvp_says_check check (going or attended);

-- "My RSVPs" on sign-in.
create index if not exists gathering_rsvp_user_idx on gathering_rsvp (user_id);
