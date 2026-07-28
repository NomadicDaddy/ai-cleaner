import type * as fs from 'node:fs';

import * as os from 'node:os';
import * as path from 'node:path';

import type { CleanupTarget } from './config.ts';
import type { FilesystemAdapter } from './filesystem-adapter.ts';

import { isRecord } from './config.ts';
import { isDangerousRootPath } from './dangerous-roots.ts';
import { defaultFilesystemAdapter } from './filesystem-adapter.ts';
import { errorMessage, formatLogValue } from './reporting.ts';

export interface PlannedRoot {
	configuredPath: string;
	resolvedPath: string;
	canonicalPath: string;
	label: string;
}

export interface PlannedTarget {
	target: CleanupTarget;
	roots: PlannedRoot[];
}

export interface Artifact {
	path: string;
	time: number;
	isDirectory: boolean;
	isFile: boolean;
}

export const normalizeForCompare = (candidatePath: string): string => {
	const resolved = path.resolve(candidatePath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

export const expandPath = (inputPath: string): string => {
	let expanded = inputPath;
	if (expanded === '~') {
		expanded = os.homedir();
	} else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
		expanded = path.join(os.homedir(), expanded.slice(2));
	}
	const resolveEnvironmentVariable = (_match: string, name: string): string => {
		const value = process.env[name];
		if (value === undefined || value.length === 0) {
			throw new Error(
				`Path references unavailable environment variable ${name}: ${formatLogValue(inputPath)}`
			);
		}
		return value;
	};
	expanded = expanded.replace(/%([^%]+)%/g, resolveEnvironmentVariable);
	expanded = expanded.replace(/\$([A-Z_][A-Z0-9_]*)/gi, resolveEnvironmentVariable);
	return path.resolve(process.cwd(), expanded);
};

const SENSITIVE_NAME_PATTERNS = [
	/(^|[\\/])\.env($|[\\/.\w-])/i,
	/(^|[\\/])\.git($|[\\/])/i,
	/(^|[\\/])\.ssh($|[\\/])/i,
	/(^|[\\/])(agents?|skills?|plugins?|memories|rules|auth|database)(\.[\w-]+)?$/i,
	/(^|[\\/])(settings|config|rules|prompts?|instructions?|credentials?|secrets?|keys?|mcp)(\.[\w-]+)?$/i,
	/(^|[\\/]).*(credential|secret|token|apikey|api-key|private-key|id_rsa).*$/i,
];

const isSensitivePath = (candidatePath: string): boolean => {
	const normalized = candidatePath.replace(/\\/g, '/');
	return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
};

const assertPathHasNoLinks = (
	candidatePath: string,
	label: string,
	fsAdapter: FilesystemAdapter
): void => {
	const resolved = path.resolve(candidatePath);
	const root = path.parse(resolved).root;
	const segments = resolved.slice(root.length).split(path.sep).filter(Boolean);
	let current = root;
	for (const segment of segments) {
		current = path.join(current, segment);
		let stats: fs.Stats;
		try {
			stats = fsAdapter.lstatSync(current);
		} catch (err) {
			const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
			if (code === 'ENOENT') {
				return;
			}
			throw new Error(
				`Cannot inspect ${label} ${formatLogValue(current)}: ${errorMessage(err)}`,
				{
					cause: err,
				}
			);
		}
		if (stats.isSymbolicLink()) {
			throw new Error(
				`${label} traverses a symbolic link or junction: ${formatLogValue(current)}`
			);
		}
	}
};

const isWithinOrEqual = (candidatePath: string, rootPath: string): boolean => {
	const relative = path.relative(rootPath, candidatePath);
	return (
		relative === '' ||
		(!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
	);
};

const assertNotDangerousRoot = (candidatePath: string, label: string, kind: string): void => {
	if (isDangerousRootPath(candidatePath)) {
		throw new Error(
			`Refusing dangerous ${kind} root for ${label}: ${formatLogValue(candidatePath)}`
		);
	}
};

const resolveCanonicalPath = (
	resolvedPath: string,
	label: string,
	fsAdapter: FilesystemAdapter
): string => {
	try {
		return fsAdapter.realpathSync(resolvedPath);
	} catch (err) {
		const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
		if (code === 'ENOENT') return resolvedPath;
		throw new Error(
			`Cannot resolve ${label} ${formatLogValue(resolvedPath)}: ${errorMessage(err)}`,
			{ cause: err }
		);
	}
};

/** Existing roots must be directories; missing roots stay allowed for later no-op. */
const assertExistingRootIsDirectory = (
	candidatePath: string,
	label: string,
	fsAdapter: FilesystemAdapter
): void => {
	let stats: fs.Stats;
	try {
		stats = fsAdapter.lstatSync(candidatePath);
	} catch (err) {
		const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
		if (code === 'ENOENT') {
			return;
		}
		throw new Error(
			`Cannot inspect ${label} ${formatLogValue(candidatePath)}: ${errorMessage(err)}`,
			{ cause: err }
		);
	}
	if (stats.isSymbolicLink()) {
		throw new Error(
			`Refusing symbolic link or junction cleanup root: ${formatLogValue(candidatePath)}`
		);
	}
	if (!stats.isDirectory()) {
		throw new Error(
			`Cleanup root for ${label} is not a directory: ${formatLogValue(candidatePath)}`
		);
	}
};

export const planRoot = (
	configuredPath: string,
	label: string,
	fsAdapter: FilesystemAdapter = defaultFilesystemAdapter
): PlannedRoot => {
	const resolvedPath = expandPath(configuredPath);
	assertNotDangerousRoot(resolvedPath, label, 'cleanup');
	assertPathHasNoLinks(resolvedPath, label, fsAdapter);
	const canonicalPath = resolveCanonicalPath(resolvedPath, label, fsAdapter);
	assertNotDangerousRoot(canonicalPath, label, 'canonical');
	if (normalizeForCompare(canonicalPath) !== normalizeForCompare(resolvedPath)) {
		throw new Error(
			`${label} resolves through a symbolic link or junction: ${formatLogValue(resolvedPath)}`
		);
	}
	assertExistingRootIsDirectory(resolvedPath, label, fsAdapter);
	return { configuredPath, resolvedPath, canonicalPath, label };
};
const assertNoOverlappingRoots = (roots: PlannedRoot[]): void => {
	for (let index = 0; index < roots.length; index++) {
		for (let otherIndex = index + 1; otherIndex < roots.length; otherIndex++) {
			const first = roots[index]!;
			const second = roots[otherIndex]!;
			const firstPath = normalizeForCompare(first.canonicalPath);
			const secondPath = normalizeForCompare(second.canonicalPath);
			if (isWithinOrEqual(firstPath, secondPath) || isWithinOrEqual(secondPath, firstPath)) {
				throw new Error(
					`Cleanup roots overlap (${first.label}: ${formatLogValue(first.resolvedPath)}; ` +
						`${second.label}: ${formatLogValue(second.resolvedPath)}).`
				);
			}
		}
	}
};

export const buildTargetPlan = (
	targets: CleanupTarget[],
	fsAdapter: FilesystemAdapter = defaultFilesystemAdapter
): PlannedTarget[] => {
	const plannedTargets = targets.map((target, targetIndex) => ({
		target,
		roots: target.paths.map((configuredPath, pathIndex) =>
			planRoot(configuredPath, `targets[${targetIndex}].paths[${pathIndex}]`, fsAdapter)
		),
	}));
	assertNoOverlappingRoots(plannedTargets.flatMap((target) => target.roots));
	return plannedTargets;
};

const lstatOrThrow = (candidatePath: string, fsAdapter: FilesystemAdapter): fs.Stats => {
	try {
		return fsAdapter.lstatSync(candidatePath);
	} catch (err) {
		throw new Error(`Cannot inspect ${formatLogValue(candidatePath)}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
};

const readdirOrThrow = (candidatePath: string, fsAdapter: FilesystemAdapter): fs.Dirent[] => {
	try {
		return fsAdapter.readdirSync(candidatePath);
	} catch (err) {
		throw new Error(`Cannot read ${formatLogValue(candidatePath)}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
};

const inspectDirectoryDescendants = (
	artifactPath: string,
	fsAdapter: FilesystemAdapter
): string | undefined => {
	for (const entry of readdirOrThrow(artifactPath, fsAdapter)) {
		const found = inspectProtectedSubtree(path.join(artifactPath, entry.name), fsAdapter);
		if (found !== undefined) return found;
	}
	return undefined;
};

export const inspectProtectedSubtree = (
	artifactPath: string,
	fsAdapter: FilesystemAdapter = defaultFilesystemAdapter
): string | undefined => {
	if (isSensitivePath(artifactPath)) {
		return `sensitive path ${formatLogValue(artifactPath)}`;
	}
	const stats = lstatOrThrow(artifactPath, fsAdapter);
	if (stats.isSymbolicLink()) {
		return `symbolic link or junction ${formatLogValue(artifactPath)}`;
	}
	if (!stats.isDirectory()) return undefined;
	return inspectDirectoryDescendants(artifactPath, fsAdapter);
};

export const revalidateContainment = (
	root: PlannedRoot,
	artifactPath: string,
	fsAdapter: FilesystemAdapter = defaultFilesystemAdapter
): void => {
	assertPathHasNoLinks(root.resolvedPath, root.label, fsAdapter);
	const currentRoot = fsAdapter.realpathSync(root.resolvedPath);
	if (normalizeForCompare(currentRoot) !== normalizeForCompare(root.canonicalPath)) {
		throw new Error(
			`Cleanup root changed after planning: ${formatLogValue(root.resolvedPath)}`
		);
	}
	const artifactStats = fsAdapter.lstatSync(artifactPath);
	if (artifactStats.isSymbolicLink()) {
		throw new Error(
			`Artifact became a symbolic link or junction: ${formatLogValue(artifactPath)}`
		);
	}
	const currentArtifact = fsAdapter.realpathSync(artifactPath);
	if (!isWithinOrEqual(normalizeForCompare(currentArtifact), normalizeForCompare(currentRoot))) {
		throw new Error(`Artifact escaped its cleanup root: ${formatLogValue(artifactPath)}`);
	}
};
