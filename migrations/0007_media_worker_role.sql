-- migrate: no-transaction
-- migrate: skip-embedded
-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` and the compose "migrate" profile do, and only when
-- DATABASE_URL and MEDIA_WORKER_DB_PASSWORD are set.
--
-- Creates the login used only by the media worker. The password is not stored
-- in this file. scripts/migrate.mjs substitutes MEDIA_WORKER_DB_PASSWORD,
-- which must be 16 or more letters and digits. Embedded preview databases
-- skip this file.
--
-- The role can read and update media_object and media_job, and delete those
-- rows. It cannot read accounts, rooms, or invite tables. If apply stops
-- after creating the role, drop role media_worker and run the migrator again.

create role media_worker
  login
  password '@@MEDIA_WORKER_DB_PASSWORD@@'
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit;

grant usage on schema public to media_worker;

grant select, update, delete on table media_object, media_job to media_worker;
