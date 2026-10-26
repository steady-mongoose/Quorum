-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0017. 0016 is reserved for group-ban inheritance.
-- Adds board_csam_hold.key_id so a reseal can tell which key encrypted a hold.
-- A second run is safe. This file does not create or replace a function.

alter table board_csam_hold add column if not exists key_id text not null default '';
