# aicleaner

Routine cleanup for AI coding agent / harness artifacts (sessions, logs, caches) with per-tool retention policies, dry-run preview, and safety guards.

Single-file Bun + TypeScript CLI. Zero runtime dependencies.

## Install

```sh
bun install
```

## Usage

```sh
bun index.ts [options]
```

| Option            | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `--config <path>` | Path to config JSON (default: `config.json`)                  |
| `--dry-run`       | Print what would be deleted without touching anything         |
| `--aggressive`    | Process targets marked `risk: aggressive` (otherwise skipped) |
| `--help`, `-h`    | Show usage                                                    |

Unknown arguments cause exit code 2.

## Configuration

See [`config.example.json`](./config.example.json). All fields are optional unless noted.

```jsonc
{
	"aggressive": false, // global aggressive mode (overridden by --aggressive flag)
	"defaultRetention": { "keepCount": 5 },
	"overrides": {
		// per-tool retention for legacy targetPaths mode
		"aider": { "keepCount": 2 },
	},
	"presets": {
		// named preset definitions - referenced by `usePresets`
		"claude-code": [
			{
				"name": "Claude Code project sessions",
				"tool": "claude-code",
				"paths": ["./.claude/sessions"],
			},
			{
				"name": "Claude Code global artifacts",
				"tool": "claude-code",
				"paths": ["~/.claude/projects", "~/.claude/sessions" /* ... */],
				"kind": "any",
				"risk": "aggressive",
			},
		],
		// ... see config.example.json for the full set
	},
	"targets": [
		// explicit targets (preferred for one-offs not worth a preset)
		{
			"name": "Local harness logs",
			"tool": "test-harness",
			"paths": ["./test-harness/logs"],
			"kind": "any", // "directory" (default) | "file" | "any"
			"retention": { "keepCount": 2 },
			"risk": "aggressive", // gated behind --aggressive
			"enabled": true,
		},
	],
	"targetPaths": ["./test-harness"], // legacy: each subdir becomes its own target
	"usePresets": ["claude-code", "codex" /* ... */], // optional; omit to run all presets
}
```

### Presets

`presets` is a name → target-list map. Presets and `targets` share the same shape (`name`, `tool`, `paths`, `kind`, `retention`, `risk`, `enabled`).

`usePresets` is optional:

- **Omitted (default)** — every preset defined in `presets` is active.
- **Provided** — only the named presets run; the rest are defined-but-inactive. Useful when one config is shared across machines that have different agents installed. Names not found in `presets` are warned about and skipped.

The shipped `config.example.json` defines presets for every supported agent — copy it as a starting point, then add or trim entries as needed for your machine.

### Retention policies

Exactly one of `keepCount` or `keepDays` per policy:

- `keepCount: N` — keep the N most recently modified entries, delete the rest.
- `keepDays: N` — delete entries older than N days.
- `allowEmpty: true` — required to use `keepCount: 0` (which deletes everything matching).

Path tokens: `~`, `~/...`, `%VAR%`, and `$VAR` are expanded.

### Path resolution order

For each run, targets are processed in this order:

1. Presets named in `usePresets`
2. Entries in `targets`
3. Subdirectories enumerated from `targetPaths` (legacy mode)

Legacy entries that resolve to a path already covered by an explicit preset/target are skipped (logged).

## Safety

- **Dry-run first.** Use `--dry-run` to preview before any real run.
- **Sensitive name filter.** Files/directories matching credential, secret, key, `.env`, `.git`, `.ssh`, `settings`, `config`, `mcp`, `prompts`, `instructions`, etc. are never deleted, even if selected by retention policy.
- **Dangerous root deny-list.** The cleaner refuses to operate on system roots (`/`, `/etc`, `C:\Windows`, `C:\Users`, `os.homedir()`, etc.) regardless of config.
- **Aggressive gate.** Targets with `risk: "aggressive"` (mostly the global `~/.<tool>/...` preset entries) are skipped unless `--aggressive` is passed.
- **`keepCount: 0` requires opt-in.** Catches typos that would otherwise wipe a target.

## Scripts

| Script                 | What it runs         |
| ---------------------- | -------------------- |
| `bun start`            | `bun index.ts`       |
| `bun run typecheck`    | `tsc --noEmit`       |
| `bun run format`       | `prettier --write .` |
| `bun run format:check` | `prettier --check .` |

## License

MIT
