# ADR 0002: Double revalidation before each deletion

Date: 2026-07-16

## Context

Between the time the tool plans a cleanup run and the moment it deletes an artifact,
the filesystem can change. A competing process could replace a directory with a
symlink, move sensitive files into a target path, or alter the root itself. This is a
classic time-of-check-to-time-of-use (TOCTOU) window. Because the tool deletes
recursively, a TOCTOU attack could cause deletion of unintended data.

## Decision

In apply mode, the tool revalidates containment twice per artifact:

1. Once before the protected-subtree inspection, to ensure the root and artifact path
   are still what was planned.
2. Once immediately before `fs.rmSync`, to close the window between inspection and
   deletion.

Each revalidation checks that the root's canonical path has not changed, that the
artifact is still within its root, and that the artifact has not become a symlink.

## Alternatives Considered

1. **Single revalidation before deletion.** Leaves a window between the
   protected-subtree inspection and the deletion call. A symlink swap during that
   window could cause the tool to delete through the link.

2. **Filesystem locking or transactions.** Node's `fs` module does not provide
   cross-platform directory locking. Attempting it would add complexity and
   platform-specific code for marginal benefit.

3. **No revalidation (trust the plan).** Acceptable for a low-risk tool, but ai-cleaner
   operates on user home directories where the cost of a mistake is high.

## Consequences

Every deletion incurs two extra `lstatSync` and `realpathSync` calls per artifact.
This is negligible for the expected scale (hundreds to low thousands of artifacts per
run). The double check ensures that even if the protected-subtree walk is slow and a
race occurs during it, the final revalidation catches the change before deletion.
