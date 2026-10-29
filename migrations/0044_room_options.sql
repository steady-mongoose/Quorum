-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0044. Other numbers are reserved by other pull requests.
-- 0010, 0015, and 0017 are already on production and are not changed here.
-- This file does not replace an anonymize function.
--
-- What a room includes, chosen by an admin when the room is set up and
-- changed later as needs dictate: roll call, the member list, room chat, and
-- video calls. Roll call is off unless an admin turns it on, in every room,
-- including the rooms that exist today. Past write-ups and the people they
-- named are kept; a room without roll call just takes no new roll and does
-- not show who came. The other three stay on.

alter table room
  add column if not exists options text[] not null
    default array['members', 'chat', 'calls']::text[];

alter table room drop constraint if exists room_options_check;
alter table room
  add constraint room_options_check
  check (options <@ array['roll_call', 'members', 'chat', 'calls']::text[]);
