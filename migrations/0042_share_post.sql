-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
--
-- Numbered 0042. Other numbers are reserved by other pull requests.
-- 0010, 0015, and 0017 are already on production and are not changed here.
--
-- A Share post: anything a member wants to tell the room, with no proof,
-- reason, or date required. It gives a church, gym, club, or society room a
-- running stream of updates between gatherings. Every hard rule and steward
-- mark applies to it the same way it applies to every other post.
--
-- Every room that takes member posts now takes a Share post, including the
-- congregation rooms, which took only a host's write-up before. A room with no
-- member post types (a steward-only bulletin room) is left alone.

alter table board_post drop constraint if exists board_post_type_check;
alter table board_post
  add constraint board_post_type_check
  check (type in ('shared', 'did', 'asked', 'noted', 'saw', 'hosted'));

update room
set takes = array_prepend('shared', takes)
where cardinality(takes) > 0
  and not ('shared' = any (takes));
