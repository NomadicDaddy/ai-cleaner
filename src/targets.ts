import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CleanupTarget, Config } from './config.ts';

import { DEFAULT_RETENTION, isRecord } from './config.ts';
import { expandPath, normalizeForCompare, planRoot } from './filesystem-safety.ts';
import { errorMessage, formatLogValue } from './reporting.ts';

export const presetTargetsFromConfig = (config: Config): CleanupTarget[] => {
	const presets = config.presets ?? {};
	const selected = config.usePresets ?? Object.keys(presets);
	return selected.flatMap((presetName) => presets[presetName] ?? []);
};

const readLegacyRootEntries = (rootPath: string): fs.Dirent[] | undefined => {
	try {
		return fs.readdirSync(rootPath, { withFileTypes: true });
	} catch (err) {
		const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
		if (code === 'ENOENT') {
			console.warn(`Target path does not exist: ${formatLogValue(rootPath)}`);
			return undefined;
		}
		// Path stays raw here; formatErrorMessage at the stderr emission boundary
		// (index.ts) applies formatLogValue once to the full diagnostic.
		throw new Error(`Cannot read ${rootPath}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
};

const isLegacyDirectoryEntry = (dirent: fs.Dirent): boolean =>
	dirent.isDirectory() && !dirent.isSymbolicLink();

const legacyTargetFromEntry = (
	targetPath: string,
	dirent: fs.Dirent,
	config: Config,
	explicitPaths: Set<string>
): CleanupTarget | undefined => {
	const subPath = path.join(targetPath, dirent.name);
	const expandedSubPath = normalizeForCompare(expandPath(subPath));
	if (explicitPaths.has(expandedSubPath)) {
		console.log(
			`Skipping legacy entry already covered by explicit target: ${formatLogValue(subPath)}`
		);
		return undefined;
	}
	return {
		name: `${dirent.name} legacy artifacts`,
		tool: dirent.name,
		paths: [subPath],
		retention: config.overrides?.[dirent.name] ?? config.defaultRetention ?? DEFAULT_RETENTION,
	};
};

const legacyTargetsFromOneRoot = (
	targetPath: string,
	config: Config,
	explicitPaths: Set<string>
): CleanupTarget[] => {
	const root = planRoot(targetPath, `targetPaths entry ${targetPath}`);
	const entries = readLegacyRootEntries(root.resolvedPath);
	if (entries === undefined) {
		return [];
	}
	const targets: CleanupTarget[] = [];
	for (const dirent of entries) {
		if (!isLegacyDirectoryEntry(dirent)) {
			continue;
		}
		const target = legacyTargetFromEntry(targetPath, dirent, config, explicitPaths);
		if (target !== undefined) {
			targets.push(target);
		}
	}
	return targets;
};

export const legacyTargetsFromConfig = (
	config: Config,
	explicitPaths: Set<string>
): CleanupTarget[] => {
	const targets: CleanupTarget[] = [];
	for (const targetPath of config.targetPaths ?? []) {
		targets.push(...legacyTargetsFromOneRoot(targetPath, config, explicitPaths));
	}
	return targets;
};
