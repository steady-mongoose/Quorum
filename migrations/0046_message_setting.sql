-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0046. Other numbers are reserved by other pull requests.
-- This file does not replace an anonymize function. Deleting an account
-- still drops the members row, and this column goes with it.
--
-- Each member chooses who can message them:
--   rooms          People in my rooms or meetings (the default, the same as before)
--   conversations  Only people I've messaged before: the member has sent at
--                  least one message in their conversation with the sender
--   none           No one
-- A refusal from this setting reads the same as a refusal from a block, so
-- nobody can tell which one stopped them. A member with no members row has
-- the default.
--
-- Messages expire, so "messaged before" is kept as a lasting marker on the
-- conversation: user_a_wrote_at / user_b_wrote_at are set the first time each
-- side sends and are never cleared. They are backfilled here from the
-- messages that still exist.
--
-- Nothing here is a count, a like, a score, or a rank. Safe to run twice.

set local lock_timeout = '5s';

alter table members add column if not exists message_from text not null default 'rooms';

alter table members drop constraint if exists members_message_from_check;
alter table members add constraint members_message_from_check
  check (message_from in ('rooms', 'conversations', 'none')) not valid;
alter table members validate constraint members_message_from_check;

alter table dm_thread add column if not exists user_a_wrote_at timestamptz;
alter table dm_thread add column if not exists user_b_wrote_at timestamptz;

update dm_thread t
   set user_a_wrote_at = (
     select min(m.created_at) from dm_message m
      where m.thread_id = t.id and m.sender_user_id = t.user_a
   )
 where t.user_a_wrote_at is null
   and exists (
     select 1 from dm_message m where m.thread_id = t.id and m.sender_user_id = t.user_a
   );

update dm_thread t
   set user_b_wrote_at = (
     select min(m.created_at) from dm_message m
      where m.thread_id = t.id and m.sender_user_id = t.user_b
   )
 where t.user_b_wrote_at is null
   and exists (
     select 1 from dm_message m where m.thread_id = t.id and m.sender_user_id = t.user_b
   );
