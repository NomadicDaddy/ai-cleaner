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

export const legacyTargetsFromConfig = (
	config: Config,
	explicitPaths: Set<string>
): CleanupTarget[] => {
	const targets: CleanupTarget[] = [];
	for (const targetPath of config.targetPaths ?? []) {
		const root = planRoot(targetPath, `targetPaths entry ${targetPath}`);
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(root.resolvedPath, { withFileTypes: true });
		} catch (err) {
			const code = isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
			if (code === 'ENOENT') {
				console.warn(`Target path does not exist: ${formatLogValue(root.resolvedPath)}`);
				continue;
			}
			throw new Error(`Cannot read ${root.resolvedPath}: ${errorMessage(err)}`, {
				cause: err,
			});
		}
		for (const dirent of entries) {
			if (!dirent.isDirectory() || dirent.isSymbolicLink()) {
				continue;
			}
			const subPath = path.join(targetPath, dirent.name);
			const expandedSubPath = normalizeForCompare(expandPath(subPath));
			if (explicitPaths.has(expandedSubPath)) {
				console.log(
					`Skipping legacy entry already covered by explicit target: ${formatLogValue(subPath)}`
				);
				continue;
			}
			targets.push({
				name: `${dirent.name} legacy artifacts`,
				tool: dirent.name,
				paths: [subPath],
				retention:
					config.overrides?.[dirent.name] ?? config.defaultRetention ?? DEFAULT_RETENTION,
			});
		}
	}
	return targets;
};
