-- A CSAM report on a chat line flags it for the custodian too, as a post report does.
-- The flag names the chat line; there is no file to hide, and nobody opens anything.
alter table csam_flag add column if not exists chat_message_id text not null default '';
alter table csam_flag drop constraint if exists csam_flag_check;
alter table csam_flag add constraint csam_flag_check
  check (post_id <> '' or media_id <> '' or chat_message_id <> '');
