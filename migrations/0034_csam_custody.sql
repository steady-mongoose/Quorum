-- Numbered 0034 (0031-0033 are taken by queued PRs).
-- CSAM holds: only named custodians (the owner, plus at most three admins the owner names)
-- can reach a hold. Every access is logged. Every match is reported to NCMEC and
-- preserved for at least one year. A hold is released only with a recorded lawyer
-- sign-off (name and reference, logged); no custodian releases on their own judgement.
-- The purge needs the year to have passed, a filed report and that sign-off.

create table if not exists csam_custodian (
  user_id text primary key references "user" (id) on delete cascade,
  granted_by_user_id text references "user" (id) on delete set null,
  granted_at timestamptz not null default now()
);

create table if not exists csam_access_log (
  id text primary key,
  hold_id text not null default '',
  actor_user_id text references "user" (id) on delete set null,
  action text not null check (
    action in ('list', 'file_report', 'legal_hold_on', 'legal_hold_off', 'purge',
               'grant_custodian', 'revoke_custodian', 'denied', 'flag', 'remove_flagged',
               'hold_released')
  ),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

-- Upgrade step: an earlier draft of this migration created csam_access_log without
-- 'hold_released' in the action check. "create table if not exists" leaves that old check
-- in place, so every hold release would fail its log insert. Replace the check by name.
-- Idempotent, and a no-op change on a fresh database.
alter table csam_access_log drop constraint if exists csam_access_log_action_check;
alter table csam_access_log add constraint csam_access_log_action_check check (
  action in ('list', 'file_report', 'legal_hold_on', 'legal_hold_off', 'purge',
             'grant_custodian', 'revoke_custodian', 'denied', 'flag', 'remove_flagged',
             'hold_released')
);

create index if not exists csam_access_log_hold_idx on csam_access_log (hold_id, created_at);

alter table board_csam_hold add column if not exists legal_hold boolean not null default false;
alter table board_csam_hold add column if not exists legal_hold_note text not null default '';
alter table board_csam_hold add column if not exists legal_hold_by_user_id text
  references "user" (id) on delete set null;
alter table board_csam_hold add column if not exists legal_hold_at timestamptz;

-- No person views CSAM in the app. The queue shows metadata only: a SHA-256 of each
-- held file, the file ids, the uploader, the reporter, the reason and the time.
alter table board_csam_hold add column if not exists file_ids text[] not null default '{}';
alter table board_csam_hold add column if not exists file_hashes text[] not null default '{}';
alter table board_csam_hold add column if not exists reporter_name text not null default '';
alter table board_csam_hold add column if not exists report_reason text not null default '';

-- A member report or a scanner flag. While a flag is open, the media route serves none
-- of the post's files to anyone, the owner and admins included.
create table if not exists csam_flag (
  id text primary key,
  post_id text not null default '',
  media_id text not null default '',
  source text not null check (source in ('report', 'scanner')),
  reporter_user_id text references "user" (id) on delete set null,
  reporter_name text not null default '',
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  hold_id text not null default '',
  check (post_id <> '' or media_id <> '')
);

-- A flag is never released. It closes only when its post is preserved and removed.
alter table csam_flag add column if not exists resolution text not null default ''
  check (resolution in ('', 'removed'));

-- The lawyer sign-off that releases a hold.
alter table board_csam_hold add column if not exists released_at timestamptz;
alter table board_csam_hold add column if not exists released_by_user_id text
  references "user" (id) on delete set null;
alter table board_csam_hold add column if not exists release_lawyer_name text not null default ''
  check (char_length(release_lawyer_name) <= 120);
alter table board_csam_hold add column if not exists release_lawyer_reference text not null default ''
  check (char_length(release_lawyer_reference) <= 120);

create index if not exists csam_flag_post_idx on csam_flag (post_id) where resolved_at is null;
create index if not exists csam_flag_media_idx on csam_flag (media_id) where resolved_at is null;
