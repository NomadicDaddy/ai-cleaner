# ADR 0001: Dry-run is the default execution mode

Date: 2026-07-16

## Context

ai-cleaner deletes files and directories from agent homes. A misconfigured target or an
accidental invocation could destroy data that is expensive or impossible to recover.
Most CLI cleanup tools default to deletion and require an opt-in flag for previewing.

## Decision

ai-cleaner defaults to dry-run. The tool prints every action it would take without
deleting anything. Deletion requires the explicit `--apply` flag. Passing both
`--dry-run` and `--apply` is an error.

## Alternatives Considered

1. **Default to deletion** (common pattern). Simpler invocations but unacceptable risk
   for a tool that operates on user home directories. One wrong path in a config file
   could wipe irreplaceable data.

2. **Interactive confirmation prompt.** Adds friction in automated contexts and scripts.
   The tool is designed for noninteractive use (scheduled runs, CI), so a prompt would
   need a `--yes` bypass anyway.

3. **Require both `--apply` and `--yes` for all deletions.** Overly cautious for
   normal-risk targets. The current design reserves the extra confirmation gate for
   aggressive targets only.

## Consequences

New users can run the tool immediately to see what it would do. Scripted cleanup
requires the explicit `--apply` flag, making accidental deletion unlikely. The
dry-run output must be accurate enough to trust: it lists exactly what would be
deleted under the current configuration, with the same safety checks applied.
