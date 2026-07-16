# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - 2026-07-16

### Added

- The package now installs an `ai-cleaner` command and includes its default configuration when packed.
- Presets now cover every agent home managed by `Fix-SkillSymlinks.ps1`, including new cleanup targets for Grok and Zcode and corrected runtime paths for Kilo and OpenCode.
- Presets can be defined and selected entirely in `config.json`; empty presets record agent homes that have no proven disposable files.

### Changed

- The project and package were renamed from `aicleaner` to `ai-cleaner`.
- Cleanup now previews by default. Deletion requires `--apply`, and aggressive deletion also requires `--aggressive --confirm-aggressive`.
- The bundled preset list now targets only immediate log, cache, session, and archived-crash entries that can be retained independently. Skill links, agent definitions, databases, authentication data, and persistent configuration are excluded.
- `config.json` is now the single default and example configuration. The duplicate `config.example.json` file was removed.
- Dependency versions are locked with Bun's text lockfile, and Node type definitions now match the declared Node 24 runtime.

### Fixed

- Configuration is validated as untrusted input before filesystem access. Invalid enums, booleans, paths, retention rules, preset references, and unknown fields now stop the run.
- Duplicate and ancestor/descendant cleanup targets are rejected instead of being processed under conflicting retention policies.
- Filesystem scan and deletion failures now produce a nonzero exit code, while successful no-op runs still exit normally.
- `--config` now reports a missing value when followed by another option.
- Production installs no longer depend on a development-only `preinstall` executable.
- Count-based retention sorts only when ordering is required; day-based retention filters entries directly.

### Security

- Filesystem, drive, and share roots are rejected dynamically, and configured paths cannot traverse symbolic links, junctions, or reparse points.
- Cleanup plans record canonical roots, reject overlapping targets, and revalidate root identity and artifact containment immediately before deletion.
- Recursive deletion is refused when a selected subtree contains sensitive files or linked content.
- `keepCount: 0` requires `allowEmpty: true`, and destructive modes require explicit command-line confirmation.

## [1.0.0]

- Initial release.
