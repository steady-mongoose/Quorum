-- Numbered 0031. Appeal policy for permanent bans.
-- A pornography removal is appealed only on a demonstrated account compromise, with evidence,
-- and only an admin decides it. A CSAM removal cannot be appealed. Every filing and decision on
-- a removal appeal is written to board_appeal_audit.

alter table board_appeal add column if not exists ground text not null default '';
alter table board_appeal add column if not exists evidence text not null default '';

alter table board_appeal drop constraint if exists board_appeal_ground_check;
alter table board_appeal
  add constraint board_appeal_ground_check
  check (ground in ('', 'account_compromise'));

alter table board_appeal drop constraint if exists board_appeal_evidence_check;
alter table board_appeal
  add constraint board_appeal_evidence_check
  check (char_length(evidence) <= 4000);

create table if not exists board_appeal_audit (
  id text primary key,
  appeal_id text not null,
  post_id text not null,
  action text not null check (action in ('filed', 'refused', 'uphold', 'lift')),
  actor_user_id text references "user" (id) on delete set null,
  rule text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists board_appeal_audit_appeal_idx
  on board_appeal_audit (appeal_id, created_at);
