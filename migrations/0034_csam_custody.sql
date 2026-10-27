-- Numbered 0034 (0031-0033 are taken by queued PRs).
-- CSAM holds: only named custodians (the owner, plus at most three admins the owner names)
-- can reach a hold. Every access is logged. A legal hold stops the one-year purge.

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
               'release_requested', 'release_confirmed')
  ),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
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

-- Release of a false flag. NEEDS JOSH'S POLICY OK. Nobody views the files to decide it:
-- one custodian writes why the flag is false, and a second, different custodian confirms.
-- Both steps are in csam_access_log.
alter table csam_flag add column if not exists resolution text not null default ''
  check (resolution in ('', 'removed', 'released'));
alter table csam_flag add column if not exists release_requested_by_user_id text
  references "user" (id) on delete set null;
alter table csam_flag add column if not exists release_reason text not null default ''
  check (char_length(release_reason) <= 500);
alter table csam_flag add column if not exists release_requested_at timestamptz;
alter table csam_flag add column if not exists released_by_user_id text
  references "user" (id) on delete set null;

create index if not exists csam_flag_post_idx on csam_flag (post_id) where resolved_at is null;
create index if not exists csam_flag_media_idx on csam_flag (media_id) where resolved_at is null;
