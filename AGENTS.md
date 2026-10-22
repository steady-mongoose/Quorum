# Avouch Social

Invite-only rooms for the church, the shop, and the county. No feed algorithm, no likes, no reshares, and no scores.

## Execution loop

1. Read the task.
2. Keep the change on `the-board`'s line of work.
3. Do not add a paid service.
4. Add tests for the behavior you change.
5. Leave `anonymize_*` functions alone.

6. **Brand-asset pass.** The in-flight marker is `/workspace/.grok/og-pending`. It is stale after 10 minutes. The pass checks the files on disk and reports. Do not wait_tasks and do not get_task_output.

7. Run the tests and say what passed.
