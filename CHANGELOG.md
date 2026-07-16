# Changelog

All notable changes to this project will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `--help` / `-h` flag with usage text; unknown arguments now exit 2 instead of being silently ignored.
- Dangerous-root deny-list (`/`, `/etc`, `C:\Windows`, `C:\Users`, `os.homedir()`, etc.). Targets resolving to these paths are refused with a warning at both the target and per-artifact level. Platform-aware, case-insensitive on Windows.
- `RetentionPolicy.allowEmpty` flag. `keepCount: 0` now requires `allowEmpty: true` on the same policy; otherwise validation fails fast with a clear error.
- Friendly error messages when the config file cannot be read or contains invalid JSON.
- `README.md` and this changelog.
- `codeium` preset covering both `~/.codeium/windsurf-next/{cascade,code_tracker,codemaps,context_state,implicit,database,brain,windsurf}` and the parallel `~/.codeium/windsurf/...` (stable channel) layout.
- `gemini` preset (forward-compat) covering `~/.gemini/{sessions,cache,logs}`.
- Both new presets enabled in `config.json` / `config.example.json` defaults.

### Changed

- **Preset definitions moved from `index.ts` into config (`config.presets`).** The previously hardcoded `PRESETS` map is gone; preset targets now live in `config.json` / `config.example.json` under a new top-level `presets` object, keyed by preset name. Users can now add, edit, or remove presets without modifying source.
- `usePresets` is now optional. When omitted, every preset defined in `config.presets` is active. When present, it filters to the named subset (useful for sharing one config across machines with different agents installed). The shipped `config.json` no longer defines `usePresets`; `config.example.json` retains it as a documented override.
- `claude-code` global preset expanded from `projects`/`logs` to also cover `~/.claude/{sessions,todos,tasks,shell-snapshots,file-history,paste-cache,session-env,session-reports,cache,debug,telemetry,statsig,backups}`. Sensitive-name filter continues to protect `settings.json`, `security_warnings_state*`, and other config artifacts inside these dirs.
- `codex` preset: `~/.codex/logs` → `~/.codex/log` (the actual directory name is singular); added `~/.codex/tmp`.
- `cline` global preset replaced — `~/.cline/{tasks,cache,logs}` (none of which exist) → `~/.cline/data/{sessions,logs,workspaces}`, `~/.cline/worktrees`, `~/.cline/kanban/workspaces`.
- `kilocode` global preset replaced — `~/.kilocode/{tasks,cache,logs}` (none of which exist) → `~/.kilocode/cli/{logs,workspaces}` and `~/.kilocode/cli/global/{cache,tasks,puppeteer}`.
- `windsurf` global preset replaced — `~/.windsurf/{sessions,cache,logs}` (none of which exist) → `~/.windsurf/{plans,worktrees}`.
- `kiro` global paths (`~/.kiro/{runs,cache,logs}`) are forward-compat placeholders — none currently exist on disk; the preset is left wired in case Kiro ever creates them.

### Changed

- Legacy `targetPaths` mode now skips subdirectories already covered by an explicit `targets`/`presets` entry, eliminating the dual-processing footgun where the same path could run under two different retention policies in one invocation.
- `result.matched` only increments on successful deletion (or in dry-run). Failed deletions count as `skipped`.

### Fixed

- `fs.statSync` / `fs.readdirSync` / `fs.rmSync` calls are now wrapped in try/catch. A single permission error or vanished entry no longer aborts the entire run; the failing path is warned about and processing continues.

### Security

- Refuses to operate on dangerous system roots even if explicitly configured.
- Requires explicit `allowEmpty: true` opt-in for `keepCount: 0` to prevent accidental full wipes from typos.

## [1.0.0]

- Initial commit.
