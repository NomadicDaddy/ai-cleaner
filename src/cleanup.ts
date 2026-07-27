import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ArtifactKind, RetentionPolicy } from './config.ts';
import type { Artifact, PlannedRoot, PlannedTarget } from './filesystem-safety.ts';

import { isRecord } from './config.ts';
import { inspectProtectedSubtree, revalidateContainment } from './filesystem-safety.ts';
import { errorMessage, formatLogValue } from './reporting.ts';

export interface ProcessResult {
	matched: number;
	skipped: number;
	failed: number;
}

const matchesKind = (artifact: Artifact, kind: ArtifactKind): boolean =>
	kind === 'any' || (kind === 'directory' ? artifact.isDirectory : artifact.isFile);

export const listArtifacts = (
	root: PlannedRoot,
	kind: ArtifactKind
): { artifacts: Artifact[]; failed: number } => {
	let rootStats: fs.Stats;
	try {
		rootStats = fs.lstatSync(root.resolvedPath);
	} catch (err) {
		const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
		if (code === 'ENOENT') {
			return { artifacts: [], failed: 0 };
		}
		console.error(`Cannot inspect ${formatLogValue(root.resolvedPath)}: ${errorMessage(err)}`);
		return { artifacts: [], failed: 1 };
	}
	if (rootStats.isSymbolicLink()) {
		console.error(
			`Refusing symbolic link or junction cleanup root: ${formatLogValue(root.resolvedPath)}`
		);
		return { artifacts: [], failed: 1 };
	}
	if (!rootStats.isDirectory()) {
		const artifact = {
			path: root.resolvedPath,
			time: rootStats.mtimeMs,
			isDirectory: false,
			isFile: rootStats.isFile(),
		};
		return { artifacts: matchesKind(artifact, kind) ? [artifact] : [], failed: 0 };
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root.resolvedPath, { withFileTypes: true });
	} catch (err) {
		console.error(`Cannot read ${formatLogValue(root.resolvedPath)}: ${errorMessage(err)}`);
		return { artifacts: [], failed: 1 };
	}

	const artifacts: Artifact[] = [];
	let failed = 0;
	for (const dirent of entries) {
		const artifactPath = path.join(root.resolvedPath, dirent.name);
		try {
			const stats = fs.lstatSync(artifactPath);
			if (stats.isSymbolicLink()) {
				console.error(
					`Refusing symbolic link or junction artifact: ${formatLogValue(artifactPath)}`
				);
				failed++;
				continue;
			}
			const artifact = {
				path: artifactPath,
				time: stats.mtimeMs,
				isDirectory: stats.isDirectory(),
				isFile: stats.isFile(),
			};
			if (matchesKind(artifact, kind)) {
				artifacts.push(artifact);
			}
		} catch (err) {
			console.error(`Cannot inspect ${formatLogValue(artifactPath)}: ${errorMessage(err)}`);
			failed++;
		}
	}
	return { artifacts, failed };
};

export const selectArtifactsToDelete = (
	artifacts: Artifact[],
	policy: RetentionPolicy
): Artifact[] => {
	if (policy.keepCount !== undefined) {
		return artifacts
			.toSorted((first, second) => second.time - first.time)
			.slice(policy.keepCount);
	}
	const cutoff = Date.now() - (policy.keepDays ?? 0) * 24 * 60 * 60 * 1000;
	return artifacts.filter((artifact) => artifact.time < cutoff);
};

export const processTarget = (
	plannedTarget: PlannedTarget,
	defaultRetention: RetentionPolicy,
	apply: boolean,
	aggressive: boolean
): ProcessResult => {
	const { target, roots } = plannedTarget;
	const policy = target.retention ?? defaultRetention;
	const kind = target.kind ?? 'directory';
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

	console.log(`\nAnalyzing ${formatLogValue(target.tool)} / ${formatLogValue(target.name)}...`);
	console.log(`Policy: ${JSON.stringify(policy)}`);

	for (const root of roots) {
		const scan = listArtifacts(root, kind);
		result.failed += scan.failed;
		if (scan.artifacts.length === 0) {
			console.log(`No matching artifacts under: ${formatLogValue(root.resolvedPath)}`);
			continue;
		}
		const toDelete = selectArtifactsToDelete(scan.artifacts, policy);
		if (toDelete.length === 0) {
			console.log(`No artifacts to clean under: ${formatLogValue(root.resolvedPath)}`);
			continue;
		}

		for (const artifact of toDelete) {
			try {
				revalidateContainment(root, artifact.path);
				const protectedEntry = inspectProtectedSubtree(artifact.path);
				if (protectedEntry !== undefined) {
					throw new Error(`contains protected ${protectedEntry}`);
				}
				if (!apply) {
					console.log(`[DRY RUN] Would delete: ${formatLogValue(artifact.path)}`);
					result.matched++;
					continue;
				}
				revalidateContainment(root, artifact.path);
				console.log(`Deleting: ${formatLogValue(artifact.path)}`);
				fs.rmSync(artifact.path, { recursive: true, force: false });
				result.matched++;
			} catch (err) {
				console.error(
					`Refusing or failing to delete ${formatLogValue(artifact.path)}: ${errorMessage(err)}`
				);
				result.failed++;
			}
		}
	}
	return result;
};
