-- The owner must approve this file before it is applied. It is the shared
-- store for Better Auth's rate limiter and the API's per-IP limits.
-- Better Auth queries the camelCase columns, so they stay double-quoted.
-- The API process does not apply migrations.

create table if not exists "rateLimit" (
  "id" text not null primary key,
  "key" text not null unique,
  "count" integer not null,
  "lastRequest" bigint not null
);
