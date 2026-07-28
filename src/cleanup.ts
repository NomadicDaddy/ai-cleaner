import type * as fs from 'node:fs';

import * as path from 'node:path';

import type { ArtifactKind, CleanupTarget, RetentionPolicy } from './config.ts';
import type { FilesystemAdapter } from './filesystem-adapter.ts';
import type { Artifact, PlannedRoot, PlannedTarget } from './filesystem-safety.ts';

import { isRecord } from './config.ts';
import { defaultFilesystemAdapter } from './filesystem-adapter.ts';
import { inspectProtectedSubtree, revalidateContainment } from './filesystem-safety.ts';
import { formatErrorMessage, formatLogValue } from './reporting.ts';

export interface ProcessResult {
	matched: number;
	skipped: number;
	failed: number;
}

/** Whether a target should enter filesystem planning and deletion work. */
export const isTargetProcessable = (target: CleanupTarget, aggressive: boolean): boolean =>
	target.enabled !== false && !(target.risk === 'aggressive' && !aggressive);

/**
 * Log and count a disabled or inactive-aggressive target without any filesystem
 * expansion, canonicalization, inspection, or overlap checks on its paths.
 */
export const skipInactiveTarget = (target: CleanupTarget, aggressive: boolean): ProcessResult => {
	const result: ProcessResult = { matched: 0, skipped: 0, failed: 0 };
	if (target.enabled === false) {
		console.log(
			`\nSkipping disabled target: ${formatLogValue(target.tool)} / ${formatLogValue(target.name)}`
		);
		result.skipped++;
		return result;
	}
	if (target.risk === 'aggressive' && !aggressive) {
		console.log(
			`\nSkipping aggressive target: ${formatLogValue(target.tool)} / ${formatLogValue(target.name)}`
		);
		result.skipped++;
		return result;
	}
	return result;
};

const matchesKind = (artifact: Artifact, kind: ArtifactKind): boolean =>
	kind === 'any' || (kind === 'directory' ? artifact.isDirectory : artifact.isFile);

type RootInspection = { status: 'missing' } | { status: 'failed' } | { status: 'directory' };

const lstatRoot = (root: PlannedRoot, fsAdapter: FilesystemAdapter): fs.Stats | RootInspection => {
	try {
		return fsAdapter.lstatSync(root.resolvedPath);
	} catch (err) {
		const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
		if (code === 'ENOENT') {
			return { status: 'missing' };
		}
		console.error(
			`Cannot inspect ${formatLogValue(root.resolvedPath)}: ${formatErrorMessage(err)}`
		);
		return { status: 'failed' };
	}
};

const inspectRoot = (root: PlannedRoot, fsAdapter: FilesystemAdapter): RootInspection => {
	const rootStats = lstatRoot(root, fsAdapter);
	if (!('isSymbolicLink' in rootStats)) {
		return rootStats;
	}
	if (rootStats.isSymbolicLink()) {
		console.error(
			`Refusing symbolic link or junction cleanup root: ${formatLogValue(root.resolvedPath)}`
		);
		return { status: 'failed' };
	}
	// Defensive: planRoot already requires directories; refuse any non-directory that slips through.
	if (!rootStats.isDirectory()) {
		console.error(`Refusing non-directory cleanup root: ${formatLogValue(root.resolvedPath)}`);
		return { status: 'failed' };
	}
	return { status: 'directory' };
};

const classifyDirectoryEntry = (
	artifactPath: string,
	kind: ArtifactKind,
	fsAdapter: FilesystemAdapter
): { artifact?: Artifact; failed: boolean } => {
	try {
		const stats = fsAdapter.lstatSync(artifactPath);
		if (stats.isSymbolicLink()) {
			console.error(
				`Refusing symbolic link or junction artifact: ${formatLogValue(artifactPath)}`
			);
			return { failed: true };
		}
		const artifact: Artifact = {
			path: artifactPath,
			time: stats.mtimeMs,
			isDirectory: stats.isDirectory(),
			isFile: stats.isFile(),
		};
		return matchesKind(artifact, kind) ? { artifact, failed: false } : { failed: false };
	} catch (err) {
		console.error(`Cannot inspect ${formatLogValue(artifactPath)}: ${formatErrorMessage(err)}`);
		return { failed: true };
	}
};

const collectDirectoryArtifacts = (
	root: PlannedRoot,
	kind: ArtifactKind,
	fsAdapter: FilesystemAdapter
): { artifacts: Artifact[]; failed: number } => {
	let entries: fs.Dirent[];
	try {
		entries = fsAdapter.readdirSync(root.resolvedPath);
	} catch (err) {
		console.error(
			`Cannot read ${formatLogValue(root.resolvedPath)}: ${formatErrorMessage(err)}`
		);
		return { artifacts: [], failed: 1 };
	}
	const artifacts: Artifact[] = [];
	let failed = 0;
	for (const dirent of entries) {
		const classified = classifyDirectoryEntry(
			path.join(root.resolvedPath, dirent.name),
			kind,
			fsAdapter
		);
		if (classified.failed) {
			failed++;
			continue;
		}
		if (classified.artifact !== undefined) {
			artifacts.push(classified.artifact);
		}
	}
	return { artifacts, failed };
};

const listArtifacts = (
	root: PlannedRoot,
	kind: ArtifactKind,
	fsAdapter: FilesystemAdapter = defaultFilesystemAdapter
): { artifacts: Artifact[]; failed: number } => {
	const inspection = inspectRoot(root, fsAdapter);
	if (inspection.status === 'missing') {
		return { artifacts: [], failed: 0 };
	}
	if (inspection.status === 'failed') {
		return { artifacts: [], failed: 1 };
	}
	return collectDirectoryArtifacts(root, kind, fsAdapter);
};

const selectArtifactsToDelete = (artifacts: Artifact[], policy: RetentionPolicy): Artifact[] => {
	if (policy.keepCount !== undefined) {
		return artifacts
			.slice()
			.sort((first, second) => second.time - first.time)
			.slice(policy.keepCount);
	}
	const cutoff = Date.now() - (policy.keepDays ?? 0) * 24 * 60 * 60 * 1000;
	return artifacts.filter((artifact) => artifact.time < cutoff);
};

const processArtifact = (
	root: PlannedRoot,
	artifact: Artifact,
	apply: boolean,
	result: ProcessResult,
	fsAdapter: FilesystemAdapter
): void => {
	try {
		revalidateContainment(root, artifact.path, fsAdapter);
		const protectedEntry = inspectProtectedSubtree(artifact.path, fsAdapter);
		if (protectedEntry !== undefined) {
			throw new Error(`contains protected ${protectedEntry}`);
		}
		if (!apply) {
			console.log(`[DRY RUN] Would delete: ${formatLogValue(artifact.path)}`);
			result.matched++;
			return;
		}
		revalidateContainment(root, artifact.path, fsAdapter);
		console.log(`Deleting: ${formatLogValue(artifact.path)}`);
		fsAdapter.rmSync(artifact.path, { force: false, recursive: true });
		result.matched++;
	} catch (err) {
		console.error(
			`Refusing or failing to delete ${formatLogValue(artifact.path)}: ${formatErrorMessage(err)}`
		);
		result.failed++;
	}
};

interface RootProcessContext {
	apply: boolean;
	fsAdapter: FilesystemAdapter;
	kind: ArtifactKind;
	policy: RetentionPolicy;
	result: ProcessResult;
	root: PlannedRoot;
}

const processRoot = (context: RootProcessContext): void => {
	const { apply, fsAdapter, kind, policy, result, root } = context;
	const scan = listArtifacts(root, kind, fsAdapter);
	result.failed += scan.failed;
	if (scan.artifacts.length === 0) {
		console.log(`No matching artifacts under: ${formatLogValue(root.resolvedPath)}`);
		return;
	}
	const toDelete = selectArtifactsToDelete(scan.artifacts, policy);
	if (toDelete.length === 0) {
		console.log(`No artifacts to clean under: ${formatLogValue(root.resolvedPath)}`);
		return;
	}
	for (const artifact of toDelete) {
		processArtifact(root, artifact, apply, result, fsAdapter);
	}
};

export const processTarget = (
	plannedTarget: PlannedTarget,
	defaultRetention: RetentionPolicy,
	apply: boolean,
	aggressive: boolean,
	fsAdapter: FilesystemAdapter = defaultFilesystemAdapter
): ProcessResult => {
	const { target, roots } = plannedTarget;
	const policy = target.retention ?? defaultRetention;
	const kind = target.kind ?? 'directory';
	// Defensive: run.ts partitions inactive targets before planning; direct callers
	// of processTarget still get the skip contract without filesystem work beyond planning.
	if (!isTargetProcessable(target, aggressive)) {
		return skipInactiveTarget(target, aggressive);
	}

	const result: ProcessResult = { matched: 0, skipped: 0, failed: 0 };

	console.log(`\nAnalyzing ${formatLogValue(target.tool)} / ${formatLogValue(target.name)}...`);
	console.log(`Policy: ${JSON.stringify(policy)}`);

	for (const root of roots) {
		processRoot({ apply, fsAdapter, kind, policy, result, root });
	}
	return result;
};
