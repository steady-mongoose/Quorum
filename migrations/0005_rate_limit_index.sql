-- The owner must approve this file before it is applied. Merging the pull
-- request is not that approval. Do not run it until the owner says so.
--
-- The prune deletes expired rows by "lastRequest". This index keeps that
-- delete off a full table scan. The API process does not apply migrations.
--
-- scripts/migrate.mjs runs this file inside a transaction, and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction. The table is empty before
-- launch and the prune keeps it small, so the brief lock is fine. If this
-- is applied later by hand on a large live table, run it outside a
-- transaction:
--   create index concurrently if not exists "rateLimit_lastRequest_idx"
--     on "rateLimit" ("lastRequest");

create index if not exists "rateLimit_lastRequest_idx" on "rateLimit" ("lastRequest");
