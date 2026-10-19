-- migrate: no-transaction
-- migrate: skip-embedded
-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Creates the login used only by the media worker. This file has no password.
-- scripts/migrate.mjs computes a SCRAM-SHA-256 verifier from
-- MEDIA_WORKER_DB_PASSWORD and runs
-- ALTER ROLE media_worker PASSWORD '<verifier>'
-- on every migrate, including a re-run. The password is not in this file and
-- is not sent as SQL text. Embedded preview databases skip this file.
--
-- The role can read and update media_object and media_job, and delete those
-- rows. It cannot read accounts, rooms, or invite tables.

create role media_worker
  login
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit;

grant usage on schema public to media_worker;

grant select, update, delete on table media_object, media_job to media_worker;
