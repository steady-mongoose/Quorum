# Share card

The brand-asset pass writes the share card, the X feed card, and `src/lib/og/site.json`. It checks its own work before it reports. The parent does not wait for it.

The in-flight marker is `/workspace/.grok/og-pending`. A marker older than 10 minutes is stale and no longer silences the gate.

## Brand-asset pass: check the files, then report

Write the card under `/workspace/.grok/` and hand it over with `scripts/write-atomic.mjs`. The recipes are in `references/`. Do not wait_tasks and do not get_task_output. The pass judges the files on disk itself.

A game or canvas app:

    node scripts/brand-check.mjs --game

A plain utility that keeps the placeholder card:

    node scripts/brand-check.mjs --placeholder-ok

Any other workspace, including this one:

    node scripts/brand-check.mjs --root /workspace

## Hand-over

Stage the bytes under `/workspace/.grok/`, never under `public/`. `vite build` ships `public/` as it stands.
