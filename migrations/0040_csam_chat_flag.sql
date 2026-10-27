-- A CSAM report on a chat line flags it for the custodian too, as a post report does.
-- The flag names the chat line; there is no file to hide, and nobody opens anything.
alter table csam_flag add column if not exists chat_message_id text not null default '';
alter table csam_flag drop constraint if exists csam_flag_check;
alter table csam_flag add constraint csam_flag_check
  check (post_id <> '' or media_id <> '' or chat_message_id <> '');

-- A custodian's Preserve and remove on a chat flag hides the line, seals its text
-- into a hold (same retention, NCMEC filing and lawyer-only release as a post) and
-- redacts the live row. The hold names the chat line; post_id is empty.
alter table board_csam_hold add column if not exists chat_message_id text not null default '';
create index if not exists board_csam_hold_chat_idx on board_csam_hold (chat_message_id)
  where chat_message_id <> '';
