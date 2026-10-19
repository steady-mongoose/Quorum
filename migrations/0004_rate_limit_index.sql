-- The owner must approve this file before it is applied. Merging the pull
-- request is not that approval. Do not run it until the owner says so.
--
-- The prune deletes expired rows by "lastRequest". This index keeps that
-- delete off a full table scan. The API process does not apply migrations.

create index if not exists "rateLimit_lastRequest_idx" on "rateLimit" ("lastRequest");
