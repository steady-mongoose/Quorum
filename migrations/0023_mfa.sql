-- The owner must approve this file before it is applied to a database and
-- before the pull request that adds it is merged. Applying it is a separate
-- decision from merging. The API process does not apply migrations.
-- `npm run db:migrate` does, and only when DATABASE_URL is set.
--
-- Numbered 0023. It applies after 0019. It does not read or write tables
-- added by 0020, 0021, or 0022, so it applies when those files are absent
-- and when they are already present.
--
-- TOTP secrets are encrypted at rest. The key is MFA_SECRET_KEY and is not
-- stored here. Recovery codes are argon2id hashes. Nothing here is a like,
-- a reshare, a score, or a rank.
--
-- `passkey` is reserved. The server rejects it until a later migration adds
-- the credential columns. This file does not create, replace, or drop an
-- anonymize function or trigger.

create table if not exists mfa_factor (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  kind text not null,
  status text not null,
  secret_ciphertext text not null default '',
  secret_iv text not null default '',
  key_id text not null default '',
  last_accepted_step bigint,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  disabled_at timestamptz
);

alter table mfa_factor drop constraint if exists mfa_factor_kind_check;
alter table mfa_factor add constraint mfa_factor_kind_check
  check (kind in ('totp', 'passkey'));

alter table mfa_factor drop constraint if exists mfa_factor_status_check;
alter table mfa_factor add constraint mfa_factor_status_check
  check (status in ('pending', 'active', 'disabled'));

create unique index if not exists mfa_factor_one_live_totp
  on mfa_factor (user_id)
  where kind = 'totp' and status in ('pending', 'active');

create index if not exists mfa_factor_user_idx on mfa_factor (user_id, status);

create table if not exists mfa_recovery_code (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  factor_id text not null references mfa_factor (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mfa_recovery_code_factor_idx
  on mfa_recovery_code (factor_id);

create table if not exists mfa_assurance (
  session_id text primary key references "session" (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists mfa_step_up (
  id text primary key,
  session_id text not null references "session" (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  action text not null,
  expires_at timestamptz not null,
  at timestamptz not null default now()
);

alter table mfa_step_up drop constraint if exists mfa_step_up_action_check;
alter table mfa_step_up add constraint mfa_step_up_action_check
  check (action in ('role-grant', 'mfa-reset', 'claim-approval', 'data-export'));

create index if not exists mfa_step_up_session_idx
  on mfa_step_up (session_id, action, expires_at desc);

create table if not exists mfa_lock (
  user_id text primary key references "user" (id) on delete cascade,
  fail_count integer not null default 0,
  locked_until timestamptz,
  check (fail_count >= 0 and fail_count <= 20)
);

create table if not exists mfa_reset (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  requested_by text not null references "user" (id) on delete restrict,
  status text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table mfa_reset drop constraint if exists mfa_reset_status_check;
alter table mfa_reset add constraint mfa_reset_status_check
  check (status in ('pending', 'completed', 'cancelled'));

create unique index if not exists mfa_reset_one_pending
  on mfa_reset (user_id)
  where status = 'pending';

create table if not exists mfa_reset_approval (
  id text primary key,
  reset_id text not null references mfa_reset (id) on delete cascade,
  approver_id text not null references "user" (id) on delete restrict,
  at timestamptz not null default now(),
  unique (reset_id, approver_id)
);

create table if not exists mfa_audit (
  id text primary key,
  actor_user_id text references "user" (id) on delete set null,
  subject_user_id text references "user" (id) on delete set null,
  action text not null,
  detail text not null default '',
  at timestamptz not null default now()
);

alter table mfa_audit drop constraint if exists mfa_audit_action_check;
alter table mfa_audit add constraint mfa_audit_action_check
  check (action in (
    'enroll',
    'disable',
    'recovery-use',
    'reset-request',
    'reset-approve',
    'reset-complete',
    'reset-expire'
  ));

alter table mfa_audit drop constraint if exists mfa_audit_detail_len;
alter table mfa_audit add constraint mfa_audit_detail_len
  check (char_length(detail) <= 200);

create index if not exists mfa_audit_subject_idx
  on mfa_audit (subject_user_id, at desc);
