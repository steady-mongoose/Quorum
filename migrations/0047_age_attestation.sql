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
--
-- Deploy order: apply this file first, then deploy the API that reads these
-- columns. /api/health stays 200 on a database without them, so check the
-- columns exist before the API goes out.
--
-- Rollback (by hand, owner's call; nothing in this file does it). Roll the
-- API back to the build before #119 first, then remove the three columns this
-- file adds: "user".age_confirmed_at, invite_code.minted_before_age_check and
-- invite_code.age_attested_at. The statements are in the #119 description.
-- Removing them loses every stored 18+ time, and a later re-run of this file
-- would mark every code then on file as minted before the check.

alter table invite_code
  add column if not exists age_attested_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'invite_code'::regclass
      and attname = 'minted_before_age_check'
      and not attisdropped
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
