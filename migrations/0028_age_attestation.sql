-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0028. 0020 through 0027 are reserved by other pull requests.
-- 0010, 0015, and 0017 are already on production. This file does not change
-- them and does not replace an anonymize function.
--
-- A member confirms they are 18 or older when the account is created.
-- The inviter confirms the invitee is 18 or older when the code is minted.
-- Both times are stored. A missing time is not a confirmation.

alter table invite_code
  add column if not exists age_attested_at timestamptz;

alter table "user"
  add column if not exists age_confirmed_at timestamptz;
