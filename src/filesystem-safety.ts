import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { CleanupTarget } from './config.ts';

import { isRecord } from './config.ts';
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

const DANGEROUS_PATHS: Set<string> = (() => {
	const paths = new Set<string>();
	const add = (candidatePath: string) => paths.add(normalizeForCompare(candidatePath));
	if (process.platform === 'win32') {
		for (const dangerousPath of [
			'C:\\Windows',
			'C:\\Windows\\System32',
			'C:\\Program Files',
			'C:\\Program Files (x86)',
			'C:\\Users',
			'C:\\ProgramData',
		]) {
			add(dangerousPath);
		}
	} else {
		for (const dangerousPath of [
			'/bin',
			'/boot',
			'/dev',
			'/etc',
			'/home',
			'/lib',
			'/lib64',
			'/opt',
			'/proc',
			'/root',
			'/sbin',
			'/srv',
			'/sys',
			'/usr',
			'/usr/bin',
			'/usr/local',
			'/usr/sbin',
			'/var',
			'/Users',
		]) {
			add(dangerousPath);
		}
	}
	add(os.homedir());
	return paths;
})();

const isFilesystemRoot = (candidatePath: string): boolean => {
	const resolved = path.resolve(candidatePath);
	return normalizeForCompare(resolved) === normalizeForCompare(path.parse(resolved).root);
};

const isDangerousPath = (candidatePath: string): boolean =>
	isFilesystemRoot(candidatePath) || DANGEROUS_PATHS.has(normalizeForCompare(candidatePath));

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

const assertPathHasNoLinks = (candidatePath: string, label: string): void => {
	const resolved = path.resolve(candidatePath);
	const root = path.parse(resolved).root;
	const segments = resolved.slice(root.length).split(path.sep).filter(Boolean);
	let current = root;
	for (const segment of segments) {
		current = path.join(current, segment);
		let stats: fs.Stats;
		try {
			stats = fs.lstatSync(current);
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

export const planRoot = (configuredPath: string, label: string): PlannedRoot => {
	const resolvedPath = expandPath(configuredPath);
	if (isDangerousPath(resolvedPath)) {
		throw new Error(
			`Refusing dangerous cleanup root for ${label}: ${formatLogValue(resolvedPath)}`
		);
	}
	assertPathHasNoLinks(resolvedPath, label);
	let canonicalPath = resolvedPath;
	try {
		canonicalPath = fs.realpathSync.native(resolvedPath);
	} catch (err) {
		const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
		if (code !== 'ENOENT') {
			throw new Error(
				`Cannot resolve ${label} ${formatLogValue(resolvedPath)}: ${errorMessage(err)}`,
				{
					cause: err,
				}
			);
		}
	}
	if (isDangerousPath(canonicalPath)) {
		throw new Error(
			`Refusing dangerous canonical root for ${label}: ${formatLogValue(canonicalPath)}`
		);
	}
	if (normalizeForCompare(canonicalPath) !== normalizeForCompare(resolvedPath)) {
		throw new Error(
			`${label} resolves through a symbolic link or junction: ${formatLogValue(resolvedPath)}`
		);
	}
	return { configuredPath, resolvedPath, canonicalPath, label };
};

const isWithinOrEqual = (candidatePath: string, rootPath: string): boolean => {
	const relative = path.relative(rootPath, candidatePath);
	return (
		relative === '' ||
		(!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
	);
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

export const buildTargetPlan = (targets: CleanupTarget[]): PlannedTarget[] => {
	const plannedTargets = targets.map((target, targetIndex) => ({
		target,
		roots: target.paths.map((configuredPath, pathIndex) =>
			planRoot(configuredPath, `targets[${targetIndex}].paths[${pathIndex}]`)
		),
	}));
	assertNoOverlappingRoots(plannedTargets.flatMap((target) => target.roots));
	return plannedTargets;
};

export const inspectProtectedSubtree = (artifactPath: string): string | undefined => {
	if (isSensitivePath(artifactPath)) {
		return `sensitive path ${formatLogValue(artifactPath)}`;
	}
	let stats: fs.Stats;
	try {
		stats = fs.lstatSync(artifactPath);
	} catch (err) {
		throw new Error(`Cannot inspect ${formatLogValue(artifactPath)}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
	if (stats.isSymbolicLink()) {
		return `symbolic link or junction ${formatLogValue(artifactPath)}`;
	}
	if (!stats.isDirectory()) {
		return undefined;
	}
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(artifactPath, { withFileTypes: true });
	} catch (err) {
		throw new Error(`Cannot read ${formatLogValue(artifactPath)}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
	for (const entry of entries) {
		const protectedDescendant = inspectProtectedSubtree(path.join(artifactPath, entry.name));
		if (protectedDescendant !== undefined) {
			return protectedDescendant;
		}
	}
	return undefined;
};

export const revalidateContainment = (root: PlannedRoot, artifactPath: string): void => {
	assertPathHasNoLinks(root.resolvedPath, root.label);
	const currentRoot = fs.realpathSync.native(root.resolvedPath);
	if (normalizeForCompare(currentRoot) !== normalizeForCompare(root.canonicalPath)) {
		throw new Error(
			`Cleanup root changed after planning: ${formatLogValue(root.resolvedPath)}`
		);
	}
	const artifactStats = fs.lstatSync(artifactPath);
	if (artifactStats.isSymbolicLink()) {
		throw new Error(
			`Artifact became a symbolic link or junction: ${formatLogValue(artifactPath)}`
		);
	}
	const currentArtifact = fs.realpathSync.native(artifactPath);
	if (!isWithinOrEqual(normalizeForCompare(currentArtifact), normalizeForCompare(currentRoot))) {
		throw new Error(`Artifact escaped its cleanup root: ${formatLogValue(artifactPath)}`);
	}
};
