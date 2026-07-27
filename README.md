# ai-cleaner

`ai-cleaner` removes old AI coding-agent logs, caches, sessions, and crash artifacts using
configurable retention policies. It runs on Bun with no runtime dependencies.

Cleanup is a dry run unless `--apply` is present. Targets marked `aggressive` also require
`--aggressive --confirm-aggressive` before deletion.

## Install

```sh
bun install --frozen-lockfile
```

Run it from the checkout:

```sh
bun run start -- --help
bun run start
```

The package also exposes an `ai-cleaner` executable when installed or linked as a package.

## Usage

```text
ai-cleaner [options]

--config <path>         Use another JSON configuration file
--dry-run               Preview deletions (default)
--apply                 Delete selected artifacts
--aggressive            Include targets marked aggressive
--confirm-aggressive    Confirm applied aggressive cleanup
--help, -h              Show help
```

Examples:

```sh
# Preview the bundled configuration
bun run start

# Preview aggressive targets
bun run start -- --aggressive

# Apply normal targets
bun run start -- --apply

# Apply aggressive targets after reviewing the preview
bun run start -- --apply --aggressive --confirm-aggressive

# Use a configuration relative to the current directory
bun run start -- --config ./my-cleaner.json
```

## Configuration

The bundled [`config.json`](./config.json) is both the default configuration and the copyable
example. Its presets are ordinary configuration, so you can add, remove, or replace them without
editing TypeScript.

```jsonc
{
	"aggressive": false,
	"defaultRetention": { "keepCount": 5 },
	"presets": {
		"my-agent": [
			{
				"name": "Project sessions",
				"tool": "my-agent",
				"paths": ["./.my-agent/sessions"],
				"kind": "directory",
				"retention": { "keepDays": 14 },
				"risk": "aggressive",
			},
		],
	},
	"usePresets": ["my-agent"],
	"targets": [],
}
```

All fields are optional, but every target must have `name`, `tool`, and at least one non-empty
path. Unknown fields and invalid values stop the run before any target is processed.

`usePresets` selects a subset of the configured presets. When omitted, every preset is selected.
An empty preset records that an agent home was checked but has no proven disposable artifact
surface. This prevents skill, agent, configuration, database, or authentication data from being
targeted just to make the coverage list look complete.

### Retention

Each policy defines exactly one retention rule:

- `keepCount: N` keeps the N newest immediate entries.
- `keepDays: N` removes immediate entries older than N days.
- `allowEmpty: true` is required with `keepCount: 0`.

Targets do not recurse to discover retention units. Point each target at a directory whose
immediate children are independent disposable artifacts. Recursive deletion happens only after an
entry is selected and its full subtree passes the safety checks.

Paths support `~`, `~/...`, `%VAR%`, and `$VAR`. Missing environment variables are configuration
errors.

## Agent coverage

The bundled config covers the canonical coding-agent homes. Some of these homes also receive
distributed skills and agents; those linked resources are protected and are never cleanup targets.

| Agent or home     | Cleanup coverage                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Claude Code       | Project sessions plus global cache, debug, logs, reports, snapshots, telemetry                             |
| Kilo              | Runtime logs and cache; `.config/kilo` skills and agents are preserved                                     |
| OpenCode          | Runtime logs and cache; `.config/opencode` skills and agents are preserved                                 |
| Windsurf          | No active target; no safe disposable leaf was proven (`.codeium/windsurf` and `.windsurf` homes preserved) |
| Generic `.agents` | Distribution-only home; no cleanup target                                                                  |
| Codex             | Cache, logs, and temporary directories; sessions and memories are preserved                                |
| Gemini            | Distribution-only on the inspected machine; no cleanup target                                              |
| Grok              | Logs and memory traces                                                                                     |
| Kiro              | Distribution-only on the inspected machine; no cleanup target                                              |
| Antigravity       | Nested Gemini skill home only; no cleanup target                                                           |
| Cursor            | Project history plus Cursor logs and cached application data                                               |
| Copilot           | Distribution-only on the inspected machine; no cleanup target                                              |
| Zcode             | CLI logs, v2 logs, and archived crashes                                                                    |
| Cline             | Project task history and session directories                                                               |
| Devin             | Editor and CLI logs, crash reports, superseded build caches, shell caches (both channels)                  |
| T3 Code           | Rotated `~/.t3` logs, provider caches, desktop shell caches, stale pending updates                         |

Devin is a VS Code fork, so its userData tree mixes editor caches with editor _state_. Only the caches
and logs are targets. `Backups` (hot-exit buffers for unsaved files), `User/History` (local file
history), `User/workspaceStorage`, `mcp/` (including its OAuth tokens), and `cli/sessions.db` are not.
`CachedData` uses `keepCount` because its children are per-build hash directories: keeping the two
newest preserves the running build's cache and drops the superseded ones.

T3 Code stores disposable logs beside irreplaceable state in one tree, so its targets are deliberately
narrow. `~/.t3/userdata` holds `state.sqlite` (every thread and session), `secrets/`, `clerk-tokens.json`,
`attachments/`, and the settings files; `~/.t3/worktrees` holds live git worktrees. None of those are
targets — only `~/.t3/userdata/logs` and `~/.t3/caches` are. The rotated `server.trace.ndjson.N` files are
10 MB each and dominate the home, which is why that target uses `keepCount` rather than `keepDays`:
rotation count, not age, is what bounds them.

Close the Devin and T3 Code desktop apps before applying their shell-cache targets. Chromium holds
open handles on `Cache` and `GPUCache` while either runs, and a locked file becomes a deletion
failure and a nonzero exit.

## Safety

- Filesystem, drive, and share roots are rejected dynamically.
- Cleanup roots cannot traverse symbolic links, junctions, or other reparse points.
- Duplicate and ancestor/descendant target roots are rejected before processing.
- Root identity and artifact containment are checked again immediately before deletion.
- A selected directory is skipped if any descendant is a link or has a sensitive name such as
  `.env`, `.git`, `.ssh`, `credentials`, `settings`, `skills`, `agents`, `plugins`, or `memories`.
- Safety refusals and deletion failures produce a nonzero exit code.

## Development

```sh
bun run format
bun run lint
bun run typecheck
bun test
bun run build
bun run smoke:qc
```

`smoke:qc` checks formatting, lint, and types, runs all Bun test suites, then builds the bundle and
executes it from a temporary working directory outside the repository.

The pre-push hook also protects local AIDD metadata. Repositories without a push remote can keep
their `.aidd` blueprint tracked locally. If a push remote is configured, the hook refuses tracked
or historical `.aidd` content and fails closed when it cannot inspect the pushed revision range.

## License

MIT
