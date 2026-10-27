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
               'grant_custodian', 'revoke_custodian', 'denied')
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
