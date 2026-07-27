import type { ProcessResult } from './cleanup.ts';
import type { Config } from './config.ts';
import type { FilesystemAdapter } from './filesystem-safety.ts';

import { processTarget } from './cleanup.ts';
import { CliError, HELP_TEXT, parseArgs } from './cli.ts';
import { DEFAULT_RETENTION, loadBundledConfig, loadConfig } from './config.ts';
import {
	buildTargetPlan,
	defaultFilesystemAdapter,
	expandPath,
	normalizeForCompare,
} from './filesystem-safety.ts';
import { legacyTargetsFromConfig, presetTargetsFromConfig } from './targets.ts';

export const run = (fsAdapter: FilesystemAdapter = defaultFilesystemAdapter): number => {
	const options = parseArgs();
	if (options.help) {
		console.log(HELP_TEXT);
		return 0;
	}
	const config: Config =
		options.configPath === undefined ? loadBundledConfig() : loadConfig(options.configPath);
	const aggressive = options.aggressive || config.aggressive === true;
	if (options.confirmAggressive && !aggressive) {
		throw new CliError('--confirm-aggressive requires aggressive cleanup to be enabled.');
	}
	if (options.apply && aggressive && !options.confirmAggressive) {
		throw new CliError(
			'Applied aggressive cleanup requires --confirm-aggressive for noninteractive confirmation.'
		);
	}

	console.log('Starting AI Cleaner...');
	if (!options.apply) {
		console.log('*** DRY RUN MODE ENABLED (use --apply to delete) ***');
	}
	if (aggressive) {
		console.log('*** AGGRESSIVE CLEANUP ENABLED ***');
	}

	const explicitTargets = [...presetTargetsFromConfig(config), ...(config.targets ?? [])];
	const explicitPaths = new Set(
		explicitTargets.flatMap((target) =>
			target.paths.map((configuredPath) => normalizeForCompare(expandPath(configuredPath)))
		)
	);
	const targets = [...explicitTargets, ...legacyTargetsFromConfig(config, explicitPaths)];
	if (targets.length === 0) {
		console.log('No cleanup targets configured.');
		return 0;
	}
	const plan = buildTargetPlan(targets, fsAdapter);
	const totals: ProcessResult = { matched: 0, skipped: 0, failed: 0 };
	for (const target of plan) {
		const result = processTarget(
			target,
			config.defaultRetention ?? DEFAULT_RETENTION,
			options.apply,
			aggressive,
			fsAdapter
		);
		totals.matched += result.matched;
		totals.skipped += result.skipped;
		totals.failed += result.failed;
	}
	console.log(
		`\nCleanup complete. Matched for deletion: ${totals.matched}. ` +
			`Skipped: ${totals.skipped}. Failed or refused: ${totals.failed}.`
	);
	return totals.failed === 0 ? 0 : 1;
};
