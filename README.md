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
	"targets": [
		// explicit targets (preferred)
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
	"usePresets": [
		"claude-code",
		"codex",
		"kilocode",
		"opencode",
		"kiro",
		"cursor",
		"cline",
		"windsurf",
		"antigravity",
	],
}
```

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
