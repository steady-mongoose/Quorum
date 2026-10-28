-- NEEDS JOSH'S SIGN-OFF. The owner must approve this file before it is applied
-- to a database and before the pull request that adds it is merged. The API
-- process does not apply migrations.
--
-- Numbered 0036. Earlier numbers are taken by other pull requests.
-- This file does not change 0010, 0015, or 0017 and does not replace an
-- anonymize function.
--
-- When an admin completes a deletion request, the member's posts are erased:
-- the text is replaced, the author link and name are cleared, and the time is
-- recorded. A post under a CSAM or legal hold, or under an open report, is
-- kept as it is so the hold or report can finish.

alter table board_post add column if not exists erased_at timestamptz;

alter table account_audit drop constraint if exists account_audit_action_check;
alter table account_audit add constraint account_audit_action_check check (
  action in ('deactivate', 'reactivate', 'deletion-requested', 'deletion-completed')
);
