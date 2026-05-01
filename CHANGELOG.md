# Changelog

All notable changes to this project will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `--help` / `-h` flag with usage text; unknown arguments now exit 2 instead of being silently ignored.
- Dangerous-root deny-list (`/`, `/etc`, `C:\Windows`, `C:\Users`, `os.homedir()`, etc.). Targets resolving to these paths are refused with a warning at both the target and per-artifact level. Platform-aware, case-insensitive on Windows.
- `RetentionPolicy.allowEmpty` flag. `keepCount: 0` now requires `allowEmpty: true` on the same policy; otherwise validation fails fast with a clear error.
- Friendly error messages when the config file cannot be read or contains invalid JSON.
- `README.md` and this changelog.

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
