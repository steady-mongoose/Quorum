-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. The API process does not
-- apply migrations.
--
-- Numbered 0035. Earlier numbers are taken by other pull requests.
--
-- A new member agrees to the Terms of Use and the Privacy Notice, including that
-- membership may show their religious beliefs, when the account is created. Each
-- agreement is a row: the version of the documents and the time. A later version
-- adds a new row; old rows are kept.

create table if not exists member_consent (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  kind text not null check (kind in ('terms_privacy')),
  version text not null check (char_length(version) between 1 and 64),
  accepted_at timestamptz not null default now()
);

create index if not exists member_consent_user_idx on member_consent (user_id, accepted_at);
