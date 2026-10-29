-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0046. Other numbers are reserved by other pull requests.
-- This file does not replace an anonymize function. Deleting an account
-- still drops the members row, and this column goes with it.
--
-- Each member chooses who can message them:
--   rooms          Anyone in my rooms (the default, the same as before)
--   conversations  Only people I've messaged before (a conversation already
--                  exists between the two)
--   none           No one
-- A refusal from this setting reads the same as a refusal from a block, so
-- nobody can tell which one stopped them. A member with no members row has
-- the default. Nothing here is a count, a like, a score, or a rank.
-- Safe to run twice.

alter table members add column if not exists message_from text not null default 'rooms';

alter table members drop constraint if exists members_message_from_check;
alter table members add constraint members_message_from_check
  check (message_from in ('rooms', 'conversations', 'none'));
