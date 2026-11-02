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
--agent <name>          Run only the named preset's targets (repeatable)
--dry-run               Preview deletions (default)
--apply                 Delete selected artifacts
--aggressive           Include targets marked aggressive
--confirm-aggressive    Confirm applied aggressive cleanup
--older-than <age>      Only select artifacts older than <age> (for example 30d)
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

# Preview only Claude Code targets from the bundled configuration
bun run start -- --agent claude-code

# Apply, deleting only Cursor artifacts older than 30 days
bun run start -- --apply --agent cursor --older-than 30d

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

The `--agent <name>` flag restricts a run to the named preset without a custom configuration
file. Repeat the flag to select several presets. Selections combine with `usePresets` by
intersection: a preset runs only when it is both selected on the CLI and active in the
configuration, and a selection that intersects no active preset processes no targets. While
`--agent` is in effect only preset targets run — explicit `targets` and legacy `targetPaths`
are skipped for that run.

### Retention

Each policy defines exactly one retention rule:

- `keepCount: N` keeps the N newest immediate entries.
- `keepDays: N` removes immediate entries older than N days.
- `allowEmpty: true` is required with `keepCount: 0` or `keepDays: 0` (both are full-deletion forms).

The `--older-than <age>` flag (for example `--older-than 30d`) narrows every target's selection
to artifacts older than the given age. It composes with the retention policy as an additional
constraint: an artifact is deleted only when the policy selects it **and** it passes the age
threshold, so the flag can only shrink a selection, never widen it.

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
| Agent Browser     | No active target; no safe disposable leaf was proven (`.agent-browser` home preserved)                     |
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
| LM Studio         | Monthly server logs, application logs, crash reports, Electron shell caches                                |

Agent Browser (`~/.agent-browser`) was inspected on a live installation and records an empty
preset: the home root stores thousands of session config, target, and engine files that are user
work product; `browsers/` holds the single live engine build; `sessions/`, `namespaces/`, and
`auth/` hold session state and credentials; `tmp/` holds HAR captures and screenshots kept as
evidence; and the only Chromium crash/cache leaves sit inside live, user-named profiles under
`profiles/`. No leaf was proven disposable, so none is targeted.

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

LM Studio targets only its documented disposable surfaces: `~/.lmstudio/server-logs` (monthly
directories, newest kept by count), plus `logs`, `Crashpad/reports`, and the rebuildable Electron
shell caches (`Cache`, `Code Cache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `GPUCache`) under
`~/AppData/Roaming/LM Studio`. Everything else is preserved — `models`, `conversations`,
`credentials`, `extensions`, `projects`, `scratchpads`, `skills`, `user-files`,
`working-directories`, `mcp.json`, `settings.json`, and the Electron state directories (`Local
Storage`, `Network`, `Session Storage`, `Preferences`, `Local State`, `blob_storage`, `DIPS`,
`Shared Dictionary`, `SharedStorage`). Close LM Studio before applying its targets; every target
is aggressive, so applying also needs `--aggressive --confirm-aggressive`.

## Safety

- Filesystem, drive, and share roots are rejected dynamically.
- Cleanup roots cannot traverse symbolic links, junctions, or other reparse points.
- Duplicate and ancestor/descendant target roots are rejected before processing.
- Root identity and artifact containment are checked again immediately before deletion.
- A selected directory is skipped if any descendant is a link or has a sensitive name such as
  `.env`, `.git`, `.ssh`, `credentials`, `settings`, `skills`, `agents`, `plugins`, or `memories`.
- Safety refusals and deletion failures produce a nonzero exit code.
- Path expansion (`~`, `%VAR%`, `$VAR`) uses the process environment only. Bun automatic `.env`
  loading is disabled (`bunfig.toml` `env = false` and every launch path passes `--no-env-file`),
  so a working-directory `.env` cannot silently redirect configured cleanup roots.

## Development

```sh
bun run format
bun run lint
bun run typecheck
bun test
bun run build
bun run smoke:qc
```

`smoke:qc` checks formatting, lint, and types, runs all Bun test suites, then builds the bundle,
verifies the bundle from a temporary working directory outside the repository, and verifies the
packed package tarball (contents, external-cwd help/dry-run, and cwd-`.env` isolation) that users
actually receive.

Repository and installed launches use `bun --no-env-file` (shebang, `bun run start`, test harness,
and delivery verifiers) so packed or linked executables keep the same dotenv policy outside the
checkout.

The pre-push hook protects local AIDD metadata. Repositories without a push remote can keep
their `.aidd` blueprint tracked locally. If a push remote is configured, the hook refuses tracked
or historical `.aidd` content and fails closed when it cannot inspect the pushed revision range.

Screenshot capture is root-based opt-in, not package-capability gated. The shared
`.githooks/screenshot-guard.sh` is kept byte-identical with AIDD/Spernakit for fleet identity, and
`.githooks/pre-push` invokes it unconditionally on every push. Applicability is decided by the
guard's own contract file: a repository declares capture by committing a tracked
`.screenshot-capture` file at its root. This headless CLI has no UI and no capture workflow, so it
ships no declaration — version-tag pushes pass with `no .screenshot-capture in this repository,
nothing to check` and no bypass flag. Repositories that do ship a UI keep the declaration and must
capture into `screenshots/v<version>/` before the matching tag can be pushed.

## License

MIT
