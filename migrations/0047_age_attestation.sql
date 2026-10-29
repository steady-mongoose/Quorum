-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0047. It was 0028 in pull request #65. 0046 is reserved by #111.
-- 0010, 0015, and 0017 are already on production. This file does not change
-- them and does not replace an anonymize function.
--
-- A member confirms they are 18 or older when the account is created.
-- The inviter confirms the invitee is 18 or older when the code is minted.
-- Both times are stored. A missing time is not a confirmation.
--
-- Codes minted before this file ran have no inviter confirmation, and none is
-- written for them here: no one made one. They are marked minted_before_age_check
-- instead, so they stay usable until they expire. Every signup, on any code,
-- still needs the new member's own 18+ confirmation, stored as
-- "user".age_confirmed_at. No row is deleted and no time is made up.
-- The mark is set once, when the column is first added, so a rerun of this
-- file does not mark a code minted later.

alter table invite_code
  add column if not exists age_attested_at timestamptz;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'invite_code'
      and column_name = 'minted_before_age_check'
  ) then
    alter table invite_code
      add column minted_before_age_check boolean not null default false;
    update invite_code
      set minted_before_age_check = true
      where age_attested_at is null;
  end if;
end
$$;

alter table "user"
  add column if not exists age_confirmed_at timestamptz;
