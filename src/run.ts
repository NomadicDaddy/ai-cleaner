import type { ProcessResult } from './cleanup.ts';
import type { Config } from './config.ts';
import type { FilesystemAdapter } from './filesystem-adapter.ts';

import { isTargetProcessable, processTarget, skipInactiveTarget } from './cleanup.ts';
import { CliError, HELP_TEXT, parseArgs } from './cli.ts';
import { DEFAULT_RETENTION, loadBundledConfig, loadConfig } from './config.ts';
import { defaultFilesystemAdapter } from './filesystem-adapter.ts';
import { buildTargetPlan, expandPath, normalizeForCompare } from './filesystem-safety.ts';
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
	// Only processable explicit targets claim paths for legacy dedup — inactive
	// targets must not expand environment variables or resolve filesystem paths.
	const processableExplicit = explicitTargets.filter((target) =>
		isTargetProcessable(target, aggressive)
	);
	const explicitPaths = new Set(
		processableExplicit.flatMap((target) =>
			target.paths.map((configuredPath) => normalizeForCompare(expandPath(configuredPath)))
		)
	);
	const targets = [...explicitTargets, ...legacyTargetsFromConfig(config, explicitPaths)];
	if (targets.length === 0) {
		console.log('No cleanup targets configured.');
		return 0;
	}

	// Partition before planning so disabled / inactive-aggressive targets never
	// expand, canonicalize, inspect, or overlap-check their paths. Iterate the
	// full configured list afterward so skip/analysis messages keep order.
	const processableTargets = targets.filter((target) => isTargetProcessable(target, aggressive));
	const plan = buildTargetPlan(processableTargets, fsAdapter);
	const totals: ProcessResult = { matched: 0, skipped: 0, failed: 0 };
	let planIndex = 0;
	for (const target of targets) {
		if (!isTargetProcessable(target, aggressive)) {
			const skipped = skipInactiveTarget(target, aggressive);
			totals.skipped += skipped.skipped;
			continue;
		}
		const planned = plan[planIndex];
		planIndex++;
		if (planned === undefined) {
			throw new Error('Internal error: planned target missing after partition.');
		}
		const result = processTarget(
			planned,
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
