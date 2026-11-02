# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- LM Studio preset (feature `lm-studio-preset`, v1.3, from the preset-coverage research verdict
  where LM Studio ranked priority 1 "add now"). The preset targets only surfaces verified on the
  live installation: `~/.lmstudio/server-logs` monthly directories (`kind: directory`,
  `keepCount: 3`), `~/AppData/Roaming/LM Studio/logs` and `Crashpad/reports` (`kind: any`,
  `keepDays: 14`), and the rebuildable Electron shell caches `Cache`, `Code Cache`,
  `DawnGraphiteCache`, `DawnWebGPUCache`, and `GPUCache` as a full cache reset
  (`allowEmpty: true`, `keepCount: 0`, the Devin shell-cache pattern). Every target is
  aggressive, matching the global-directory doctrine. `models`, `conversations`, `credentials`,
  `extensions`, `projects`, `scratchpads`, `skills`, `user-files`, `working-directories`,
  `mcp.json`, `settings.json`, and the Electron state directories are preserved;
  `README.md` documents the coverage row, the preserve list, and the close-LM-Studio note, and
  the bundled-config test enumerates `lm-studio`.

- Agent Browser coverage record (feature `agent-browser-preset`, v1.3). A live `~/.agent-browser`
  installation was inspected per the proven-surface doctrine and no disposable leaf was proven:
  the home root holds ~11,000 session config, target, and engine files that are user work
  product; `browsers/` holds the single live engine build; `sessions/`, `namespaces/`, and
  `auth/` hold session state and credentials; `tmp/` holds HAR captures and screenshots kept as
  evidence; and the only Chromium crash/cache leaves sit inside live, user-named profiles under
  `profiles/`. `config.json` therefore ships an empty `agent-browser` preset recording the
  checked home, `README.md` documents the checked-but-empty state in the coverage table, and
  the bundled-config test enumerates the preset alongside the other canonical homes.

- `--agent <name>` preset selection (feature `agent-selection-cli`, v1.3). The repeatable option
  restricts a run to the named preset's targets without requiring a custom configuration file,
  recording selections on `CliOptions` as `agentSelections`. `resolveAgentSelection` in
  `src/run.ts` rejects a name absent from the loaded configuration's presets as a `CliError`
  (exit 2 naming the selection, with an own-property guard against inherited names), intersects
  the selection with config-level `usePresets`, and scopes the run to presets — explicit
  `targets` and legacy `targetPaths` are skipped while a selection is in effect. An empty
  intersection processes no targets and reports that state; selecting a preset configured empty
  reports no targets rather than failing, preserving the empty-preset doctrine. `HELP_TEXT` and
  `README.md` document the flag with intersection semantics. `test/cli.test.ts` covers a bundled
  single selection, multi-select via repeated flags, an unknown name (exit 2), a terminal
  `--agent`, an empty-preset selection, the `usePresets` intersection, the empty intersection,
  and explicit-target skipping. `bun test`: 100 pass / 0 fail; `smoke:qc` passes end to end.

- `--older-than <age>` CLI filter (feature `older-than-cli-filter`, v1.3). The option accepts a
  positive day count suffixed with `d` (for example `30d`), records it on `CliOptions` as
  `olderThanDays`, and rejects a missing, malformed, or non-positive value as a `CliError`
  (exit 2 with help text). The age composes with per-target retention in
  `selectArtifactsToDelete` as an additional constraint: an artifact is selected only when the
  target's `keepCount` or `keepDays` policy selects it _and_ it is older than the given age, so
  the flag can only shrink a selection and never deletes artifacts retention would keep.
  `processTarget` reports the active constraint (`Age filter: only artifacts older than N
days`) so dry-run output shows the narrowing. `test/cli.test.ts` covers a terminal
  `--older-than`, a value without the `d` suffix, and `0d` (all exit 2); the narrowing
  composition with `keepCount` and with `keepDays`; and the unchanged selection when the flag
  is omitted. `README.md` documents the flag in the usage block, the retention section, and an
  apply example. `bun test`: 91 pass / 0 fail; `smoke:qc` passes end to end.

### Fixed

- Closed testing audit finding `audit-testing-1785911839-hook-verification-encodes-the-removed-package-capability-gate`:
  `test/hooks.test.ts` still encoded the package-capability screenshot gate that commit `8643343`
  removed from `.githooks/pre-push`, leaving the suite at 74 pass / 2 fail and short-circuiting
  `smoke:qc` before build. The suite was rewritten to the committed root-based contract in
  `.githooks/screenshot-guard.sh`: pre-push unconditionally invokes the wrapper (source assertions
  plus a repo-root run proving a version-tag push passes with no `.screenshot-capture`), success
  when the declaration file is absent, failure when an opted-in repo lacks the pushed-version
  `screenshots/v<version>/` capture, failure when the capture has too few PNGs, success on a
  complete capture, a failing AIDD history guard short-circuiting before the screenshot guard
  runs, and a screenshot-guard failure propagating through pre-push without `pre-push: passed`.
  Fixture repositories are `git init`-ed so the real history guard's no-remote early exit is
  exercised for the right reason, not vacuously. `README.md` and `.aidd/project-structure.md` now
  document the tracked-root `.screenshot-capture` opt-in contract instead of the
  `smoke:screenshots` package-capability gate. Audit feedback loop closed on source feature
  `aidd-history-guard`: spec line 5 replaced with the reconstructable root-based contract, spec
  line 6 added forbidding any package-capability probe, revision note 1.2.3 recorded. `bun test`:
  85 pass / 0 fail; `bun run smoke:qc` passes end to end.

- Closed reorg finding `audit-reorg-1785911840-two-non-test-typescript-modules-exceed-the-300-line-cap`:
  the last two non-test TypeScript modules over the 300-line cap were split. New
  `src/config-file.ts` exports `readConfigValue(configPath): unknown` (cwd-resolved UTF-8 read +
  JSON parse, preserving the exact `Failed to read config …` / `Invalid JSON in …` messages and
  causes); `src/config.ts` `loadConfig` now delegates to it and `parseConfig` stays private
  (285 lines, down from 308). New `scripts/verify-package-runtime.ts` (155 lines) exports
  `RunResult`, `runCommand`, `runPacked`, `verifyHelp`, `verifyDryRun`, `envWithout`, and
  `verifyDotenvIsolation`; `scripts/verify-package.ts` imports the helpers it consumes (202 lines,
  down from 330) with `--no-env-file` launches, archive assertions, external-cwd execution, and
  `finally`-based temp cleanup unchanged. Every non-test TS file is now ≤ 300 physical lines
  (largest: `src/filesystem-safety.ts` at 271). `bun run lint`, `bun run typecheck`, `bun test`
  (74 pass; the 2 pre-existing `test/hooks.test.ts` failures remain tracked by open finding
  `audit-testing-1785911839-hook-verification-encodes-the-removed-package-capability-gate`),
  `bun run build` (including `build:verify-package`, whose packed-archive assertion now proves the
  new `src/config-file.ts` module ships) all pass; `bun run smoke:qc` exits 1 only on those two
  pre-existing hook-test failures. `.aidd/project-structure.md` layout and module-boundary rows
  name both new modules. Feedback loop closed on source features `packaged-cli-distribution`
  (spec lines 6 and 9 amended additively; two dated revision notes) and
  `configurable-cleanup-targets` (spec line 1 amended additively; dated revision note).
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
