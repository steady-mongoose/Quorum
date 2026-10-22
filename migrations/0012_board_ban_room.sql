-- The owner must approve this file before it is applied to a database.
-- The API process does not apply migrations. `npm run db:migrate` does.
--
-- Numbered 0012. A room steward's bar is stored on board_ban.room_id.
-- An empty room_id is a site-wide bar, which only an admin writes.
-- Existing rows stay site-wide because the default is empty.
-- This file does not replace anonymize_board_user.

alter table board_ban
  add column if not exists room_id text not null default '';

create index if not exists board_ban_user_room_idx
  on board_ban (user_id, room_id, created_at desc);
