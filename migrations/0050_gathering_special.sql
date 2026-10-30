-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0050. It adds two columns to public_gathering (0018) and does not
-- touch gathering_rsvp (0049). It replaces no function and deletes nothing.
--
-- special (Josh via CoS, Oct 30 12:47 PM ET): the host's "This is a special
-- event" checkbox. RSVPs and marking who came work only on a special event;
-- every other gathering takes none (enforced in server/board/rsvp.ts). Off
-- until the host ticks it, so every existing gathering starts as not special.
--
-- moved_from: the rooms a gathering was in before a move, oldest first. A
-- member barred in a room the gathering left stays hidden from its lists
-- after the move (Josh, same answers). Room ids only, never a person.
--
-- Deploy order: apply 0049, then this file, then deploy the API that reads
-- them. The API reads both columns through to_jsonb, so it also runs before
-- this file: then nothing is special, so no RSVPs are taken, and setting the
-- checkbox answers 503.
--
-- Rollback: after deploying an API from before this file,
-- `alter table public_gathering drop column if exists special,
--  drop column if exists moved_from;`
-- A second run is safe.

alter table public_gathering add column if not exists special boolean not null default false;
alter table public_gathering add column if not exists moved_from text[] not null default '{}';
