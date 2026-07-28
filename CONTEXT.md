# CONTEXT.md

The glossary for ai-cleaner. Terms are defined in plain language without implementation
detail. File names appear only where they serve as evidence for an ambiguity.

---

## Terms

### Agent Home

The on-disk directory where a coding agent stores its data. Examples: `~/.claude`,
`~/.codex`, `~/.grok`. The tool targets specific subdirectories within agent homes,
never the homes themselves.

### Artifact

A single disposable file or directory under a Cleanup Root. The tool lists artifacts,
applies a Retention Policy to select which to delete, checks each for safety, then
deletes the selected ones (or previews them in dry-run mode).

### Aggressive Mode

A mode that enables Cleanup Targets marked `risk: aggressive`. These targets typically
operate on global user directories (under the home directory) rather than
project-local paths. Applying aggressive deletion requires explicit confirmation via
`--confirm-aggressive`.

### Cleanup Root

A single filesystem path configured in a Cleanup Target. The tool resolves, validates,
and protects each root independently. A target can have multiple roots.

### Cleanup Target

A named, configured rule that says: scan these paths, keep or remove entries according
to this Retention Policy. Each target carries a human-readable name, a tool identifier,
one or more paths, an artifact kind filter, a retention policy, an optional enabled
flag, and a risk level.

### Default Retention

The Retention Policy applied when a Cleanup Target does not define its own. The bundled
default is `keepCount: 5`.

### Disposable Artifact Surface

A directory within an Agent Home whose immediate children can be deleted without
harming agent configuration, skills, agent definitions, databases, authentication
data, or persistent settings. The tool defines targets only for proven disposable
surfaces. Empty Presets record agent homes that were checked but have no disposable
surface.

### Legacy Auto-Discovery

A backward-compatible mechanism where configured root paths (`targetPaths`) are scanned
for immediate subdirectories. Each subdirectory becomes a Cleanup Target with its own
retention policy resolved from `overrides` or Default Retention. This mechanism coexists
with explicit targets and Presets but predates them.

### Preset

A named collection of Cleanup Targets for one agent. The bundled `config.json` contains
a preset per known agent. `usePresets` selects a subset; when omitted, all presets are
active.

### Retention Policy

A rule that selects which Artifacts to delete. It uses either `keepCount` (keep the N
newest immediate entries) or `keepDays` (delete entries older than N days), but never
both. `allowEmpty: true` confirms the intent to delete everything when `keepCount: 0`
or `keepDays: 0` (both are full-deletion forms).

### Risk Level

The classification of a Cleanup Target as `normal` or `aggressive`. Normal targets run
by default. Aggressive targets require Aggressive Mode and additional confirmation when
applying.

---

## Relationships

- A Preset contains zero or more Cleanup Targets.
- A Cleanup Target has one Retention Policy and one or more Cleanup Roots.
- A Cleanup Root contains zero or more Artifacts.
- Aggressive Mode gates which Cleanup Targets are processed.
- An Agent Home may have zero or more Disposable Artifact Surfaces.
- Default Retention fills in when a Cleanup Target omits its own policy.

---

## Domain Verbs

- **Preview** (dry-run): List what would be deleted without deleting. The default mode.
- **Apply**: Delete the selected artifacts. Requires the `--apply` flag.
- **Plan**: Resolve all configured paths, reject dangerous roots, reject overlapping
  roots, and build the target list.
- **Process**: Scan a single target, list its artifacts, apply retention, check safety,
  and delete (if applying).
- **Revalidate**: Immediately before deletion, confirm the root identity and artifact
  containment have not changed since planning.

---

## Lifecycle States

A Cleanup Target moves through:

```
configured -> planned -> processed (matched | skipped | failed)
```

An Artifact moves through:

```
listed -> matched (passes kind filter) -> selected (fails retention) -> deleted | refused
```

---

## Example Dialogue

> "I want to clean Claude Code's global logs."
> "Those are in the `claude-code` preset, under the aggressive target for disposable
> global artifacts. You will need Aggressive Mode and confirmation to apply."
> "Just preview first."
> "Run without `--apply`. The tool will list each artifact selected for deletion."
> "What retention applies?"
> "That target overrides to `keepDays: 14`. Anything older than 14 days gets selected."

---

## Flagged Ambiguities

### `codeium-windsurf` vs `windsurf` presets (resolved)

These were the same agent home recorded under two names. The bundled `config.json` now
keeps a single `windsurf` preset (empty), the canonical identifier for this home. Windsurf may
live at `~/.codeium/windsurf` (legacy) or `~/.windsurf` (upstream); both are recognized. No safe
disposable leaf has been proven for either, so the preset remains empty.

### `overrides` scope

The `overrides` config field only affects Legacy Auto-Discovery targets, not explicit
targets or Presets. Its name suggests it could override retention for any target by tool
name. The current scope is narrower than the name implies. Should this be documented
more explicitly, or should the field be renamed to reflect its actual scope?

### `kind: 'any'` semantics

The bundled config uses `kind: 'any'` for many targets whose directories contain both
files and subdirectories. The default `kind` is `'directory'`, which filters to
directories only. The term "any" means "match files or directories" but could be read
as "match everything including links." Symlinks are always refused regardless of kind.
This is not ambiguous in code but is easy to misread in configuration.
