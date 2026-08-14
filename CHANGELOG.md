# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Closed hygiene finding `audit-hygiene-1785911839-test-fixture-exports-an-internally-used-type`:
  removed the `export` modifier from `RunCliEnv` in `test/cli-fixture.ts`; the type remains the
  internal contract for `RunCliOptions.env` and `buildSpawnEnv`. `bunx knip` now exits 0 with zero
  unused files, exports, types, or dependencies — no lint or Knip configuration was relaxed.
  `bun run lint`, `bun run typecheck`, `bun test`, and `bun run build` (bundle, verify-build,
  verify-package) all pass; `bun run smoke:qc` still exits 1 only on the two pre-existing
  `test/hooks.test.ts` failures (74 pass / 2 fail) already tracked by open finding
  `audit-testing-1785911839-hook-verification-encodes-the-removed-package-capability-gate`.
  Feedback loop closed on source feature `configurable-cleanup-targets`: spec line 4 amended
  additively so a feature-based rebuild keeps fixture types used only inside the fixture
  unexported, plus a dated revision note.
- Tier C TypeScript toolchain drift closed: `eslint` `10.8.0` and `globals` `17.8.0` with
  regenerated `bun.lock`; `tsconfig` module `ESNext` / `moduleResolution` `bundler` / `noEmit` /
  target `ES2022`; lint covers `scripts/` and `eslint.config.js`; `toSorted` replaced with
  `slice().sort()` under the ES2022 target (feature
  `audit-ts-standards-1785207356-tier-c-typescript-toolchain-contract-has-drifted`).
- Scenario 1 CLI argument coverage is fully automated: table-driven cases in `test/cli.test.ts`
  cover `--help`, `-h`, unknown options, terminal `--config`, option-as-config-value, and
  `--dry-run --apply` with exact exit codes, help/error markers, no target processing, and
  disposable sentinel preservation. `.aidd/testing-scenarios.md` lists each test name;
  `.aidd/assertions.md` records the verified branch coverage. Source feature
  `cli-execution-modes` requires these direct cases on rebuild (feature
  `audit-testing-1785207355-cli-argument-scenario-is-only-partially-automated`).
- Disabled Bun automatic `.env` loading so a working-directory dotenv file cannot redirect
  configured `$VAR` / `%VAR%` cleanup roots. Added root `bunfig.toml` with `env = false`, and
  pass `--no-env-file` on the executable shebang, `package.json` `start` script, CLI test
  fixture spawns, and package/bundle delivery verifiers. External-cwd tests and packed-package
  verification prove dotenv is ignored while an explicit OS environment value still expands
  (feature `audit-tech-stack-1785207357-bun-dotenv-auto-loading-can-redirect-cleanup-roots`).
- `keepDays: 0` now requires `allowEmpty: true`, matching `keepCount: 0`. Without confirmation,
  config parsing fails closed before any artifact is selected; with confirmation, dry-run remains
  the default. Docs and assertions state both full-deletion forms. Regression coverage in
  `test/cli.test.ts` (feature
  `audit-security-1785207355-keepdays-zero-bypasses-full-deletion-confirmation`).
- Filesystem and OS error diagnostics no longer leak raw control characters on stderr.
  `formatErrorMessage` in `src/reporting.ts` extracts the upstream message and applies
  `formatLogValue` once at emission in `index.ts` and `src/cleanup.ts`. Composed exceptions
  keep raw paths and nested `errorMessage` text so Windows path backslashes and agent-name
  controls are not double-escaped. Regression coverage for real ENOENT and injected
  lstat/readdir/realpath/deletion failures with newline, CR, tab, ESC, NUL, DEL, and
  backslash (feature
  `audit-security-1785207355-filesystem-error-messages-bypass-control-character-escaping`).
- Cleanup-root planning no longer admits protected operating-system descendants or regular
  files. Protected OS trees reject equal-or-descendant paths; user-container roots and the
  invoking home remain exact-only. Existing roots must be directories at `planRoot` time
  (missing roots stay no-ops), and `listArtifacts` defensively refuses non-directory roots.
  Denylist logic lives in private `src/dangerous-roots.ts` so safety modules stay under the
  300-line cap. Regression coverage in `test/cli.test.ts` and `test/release-verification.test.ts`
  (feature
  `audit-security-1785207355-cleanup-root-validation-admits-protected-system-descendants-and-regular-files`).

### Changed

- Reduced cyclomatic complexity across cleanup, CLI, config, run, targets, filesystem-safety,
  reporting, and package verification by extracting private helpers (typed flag lookup for
  `parseArgs`, retention/target/preset parsers, artifact/root processors, one-root legacy
  discovery). Unexported same-file-only symbols `listArtifacts`, `selectArtifactsToDelete`,
  `parseConfig`, `RiskLevel`, and test `entrypoint`. Audit-time complexity metrics and Knip
  unused-export checks pass; behavior, messages, and exit codes unchanged (feature
  `audit-complication-1785207356-safety-and-configuration-functions-exceed-complexity-limits`).
- Extracted `FilesystemAdapter` and `defaultFilesystemAdapter` into private
  `src/filesystem-adapter.ts` so every non-test TypeScript source file stays under 300 lines.
  Path planning remains in `src/filesystem-safety.ts`; cleanup, run, and release-verification
  tests import the adapter directly. No package export was added (feature
  `audit-reorg-1785207357-filesystem-safety-module-exceeds-the-300-line-cap`).

### Added

- `scripts/verify-package.ts` packs the published tarball with `bun pm pack`, asserts required
  package contents (including every `src/` runtime module without hard-coding the module count),
  and runs the packed entry point help and default dry-run paths from a working directory outside
  the package. `build:verify-package` invokes it; `build` runs it after the existing bundle gate so
  `smoke:qc` verifies the artifact users receive, not only `dist/ai-cleaner.js`.
- `test/hooks.test.ts` exercises the pre-push capability gate: version-tag pushes without
  `smoke:screenshots` skip the screenshot stage, empty scripts stay not-applicable, defined
  scripts still invoke the guard, and AIDD history-guard failures still fail the push.

### Fixed

- `.githooks/pre-push` no longer requires an impossible UI screenshot workflow for version tags.
  The shared `screenshot-guard.sh` stays byte-identical with AIDD/Spernakit, but the wrapper
  invokes it only when `package.json` defines a non-empty `smoke:screenshots` script; otherwise
  it prints `screenshot guard: not applicable` and continues after the AIDD history guard
  (feature `audit-devops-1785207355-version-tag-hook-requires-an-unavailable-ui-screenshot-workflow`).

## [1.2.0] - 2026-07-27

### Added

- The bundled configuration now covers Devin (editor and CLI logs, crash reports, superseded build caches, and editor shell caches for both channels) and T3 Code (rotated server and desktop logs, provider capability caches, desktop shell caches, and stale pending updates). Both tools store disposable data beside irreplaceable state, so their targets are deliberately narrow.
- A tracked MIT `LICENSE` file is now included in the published package, matching the terms the manifest and README already declared.
- An ESLint toolchain was added to the project, exposed through a `lint` script and folded into `smoke:qc`.
- A pre-push git hook (`aidd-history-guard`) lets repositories without a push remote keep local `.aidd` blueprints tracked, but blocks repositories with a push remote from publishing tracked or historical `.aidd` content.
- `scripts/verify-build.ts` proves the built command runs its help and default dry-run paths from a working directory outside the repository.
- A custom `scripts/require-bun.ts` preinstall guard replaces the third-party `only-allow bun` dependency.

### Changed

- The single 845-line `index.ts` entry point was split into seven private internal modules under `src/` (configuration, CLI parsing, filesystem safety, cleanup, targets, reporting, and orchestration) while preserving the safety pipeline and executable contract. The published package now includes `src/`.
- `smoke:qc` now runs `lint` and verifies the built bundle from an external working directory.
- The bundled agent-home list was tightened: the duplicate `codeium-windsurf` preset was collapsed into a single `windsurf` id, and private tooling references were removed from the docs, tests, and configuration so the public repository is self-contained.
- Development dependency versions were advanced (`@types/node` to 26, plus prettier, eslint, typescript-eslint, and related plugins) to match the workspace TypeScript toolchain standard.

### Fixed

- The `brace-expansion` transitive dependency (pulled through `minimatch` by the ESLint toolchain) was updated to resolve advisory GHSA-mh99-v99m-4gvg. `bun audit` now reports zero vulnerabilities.

### Security

- All untrusted values printed to the console (target names, tool names, configured paths, resolved roots, artifact paths) are now escaped through a single formatter before output, preventing control characters in agent names from forging or altering terminal and captured-log text.

## [1.1.0] - 2026-07-16

### Added

- The package now installs an `ai-cleaner` command and includes its default configuration when packed.
- Presets now cover every canonical agent home, including new cleanup targets for Grok and Zcode and corrected runtime paths for Kilo and OpenCode.
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
