-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0015. 0014 is reserved for the room-ban migration. This file
-- runs after 0012 (theme groups) and after 0013 (room chat) when that
-- table exists. Dropping the old check and adding it again makes a second
-- run safe. If room chat is added after this file has already been applied,
-- that later migration has to allow these five rules itself: an applied
-- file does not run again. 0010 carries the same block for a database
-- where 0010 is applied last.
--
-- This file does not replace anonymize_board_user, anonymize_moderation_user,
-- anonymize_theme_group_user, or anonymize_room_chat_user.

do $$
declare
  cons name;
begin
  if to_regclass('public.theme_group_post') is not null then
    for cons in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.theme_group_post'::regclass
        and c.contype = 'c'
        and c.conname is distinct from 'theme_group_post_removal_pair'
        and pg_get_constraintdef(c.oid) ilike '%removed_for%'
        and pg_get_constraintdef(c.oid) ilike '%csam%'
    loop
      execute format('alter table theme_group_post drop constraint %I', cons);
    end loop;
    alter table theme_group_post
      add constraint theme_group_post_removed_for_check
      check (removed_for is null or removed_for in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));
  end if;

  if to_regclass('public.theme_group_removal') is not null then
    for cons in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.theme_group_removal'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%reason%'
        and pg_get_constraintdef(c.oid) ilike '%csam%'
    loop
      execute format('alter table theme_group_removal drop constraint %I', cons);
    end loop;
    alter table theme_group_removal
      add constraint theme_group_removal_reason_check
      check (reason in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));
  end if;

  if to_regclass('public.room_chat_removal') is not null then
    for cons in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.room_chat_removal'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%reason%'
        and pg_get_constraintdef(c.oid) ilike '%csam%'
    loop
      execute format('alter table room_chat_removal drop constraint %I', cons);
    end loop;
    alter table room_chat_removal
      add constraint room_chat_removal_reason_check
      check (reason in ('threat', 'porn', 'csam', 'doxxing', 'blasphemy'));
  end if;
end $$;
