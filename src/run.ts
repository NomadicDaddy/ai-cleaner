import type { ProcessResult } from './cleanup.ts';
import type { CliOptions } from './cli.ts';
import type { CleanupTarget, Config } from './config.ts';
import type { FilesystemAdapter } from './filesystem-adapter.ts';

import { isTargetProcessable, processTarget, skipInactiveTarget } from './cleanup.ts';
import { CliError, HELP_TEXT, parseArgs } from './cli.ts';
import { DEFAULT_RETENTION, loadBundledConfig, loadConfig } from './config.ts';
import { defaultFilesystemAdapter } from './filesystem-adapter.ts';
import { buildTargetPlan, expandPath, normalizeForCompare } from './filesystem-safety.ts';
import { formatLogValue } from './reporting.ts';
import { legacyTargetsFromConfig, presetTargetsFromConfig } from './targets.ts';

const validateAggressiveOptions = (options: CliOptions, aggressive: boolean): void => {
	if (options.confirmAggressive && !aggressive) {
		throw new CliError('--confirm-aggressive requires aggressive cleanup to be enabled.');
	}
	if (options.apply && aggressive && !options.confirmAggressive) {
		throw new CliError(
			'Applied aggressive cleanup requires --confirm-aggressive for noninteractive confirmation.',
		);
	}
};

const logRunMode = (options: CliOptions, aggressive: boolean): void => {
	console.log('Starting AI Cleaner...');
	if (!options.apply) {
		console.log('*** DRY RUN MODE ENABLED (use --apply to delete) ***');
	}
	if (aggressive) {
		console.log('*** AGGRESSIVE CLEANUP ENABLED ***');
	}
};

interface AgentSelection {
	restricted: Config;
	selected: string[];
}

/**
 * Resolve the --agent selection against the loaded configuration: every named
 * selection must be a configured preset (CliError otherwise), and the effective
 * selection intersects with config-level usePresets. A preset selection scopes
 * the run to presets — explicit targets and legacy targetPaths are skipped —
 * and an empty intersection processes no targets, with that state reported.
 */
const resolveAgentSelection = (config: Config, selections: string[]): AgentSelection => {
	const presets = config.presets ?? {};
	for (const selection of selections) {
		// Own-property guard: inherited names such as `constructor` must never
		// count as configured presets.
		if (!Object.hasOwn(presets, selection)) {
			throw new CliError(`--agent references unknown preset: ${selection}.`);
		}
	}
	const activePresets = config.usePresets ?? Object.keys(presets);
	const selected = activePresets.filter((name) => selections.includes(name));
	const restricted: Config = { presets, usePresets: selected };
	if (config.aggressive !== undefined) restricted.aggressive = config.aggressive;
	if (config.defaultRetention !== undefined) {
		restricted.defaultRetention = config.defaultRetention;
	}
	return { restricted, selected };
};

const logAgentSelection = (selected: string[]): void => {
	if (selected.length === 0) {
		console.log('The --agent selection matches no active presets; no targets to process.');
		return;
	}
	console.log(`Agent selection: ${formatLogValue(selected.join(', '))}`);
};

const assembleTargets = (config: Config, aggressive: boolean): CleanupTarget[] => {
	const explicitTargets = [...presetTargetsFromConfig(config), ...(config.targets ?? [])];
	// Only processable explicit targets claim paths for legacy dedup — inactive
	// targets must not expand environment variables or resolve filesystem paths.
	const processableExplicit = explicitTargets.filter((target) =>
		isTargetProcessable(target, aggressive),
	);
	const explicitPaths = new Set(
		processableExplicit.flatMap((target) =>
			target.paths.map((configuredPath) => normalizeForCompare(expandPath(configuredPath))),
		),
	);
	return [...explicitTargets, ...legacyTargetsFromConfig(config, explicitPaths)];
};

const accumulateResult = (totals: ProcessResult, result: ProcessResult): void => {
	totals.matched += result.matched;
	totals.skipped += result.skipped;
	totals.failed += result.failed;
};

const processConfiguredTargets = (
	targets: CleanupTarget[],
	config: Config,
	options: CliOptions,
	aggressive: boolean,
	fsAdapter: FilesystemAdapter,
): ProcessResult => {
	// Partition before planning so disabled / inactive-aggressive targets never
	// expand, canonicalize, inspect, or overlap-check their paths. Iterate the
	// full configured list afterward so skip/analysis messages keep order.
	const processableTargets = targets.filter((target) => isTargetProcessable(target, aggressive));
	const plan = buildTargetPlan(processableTargets, fsAdapter);
	const totals: ProcessResult = { matched: 0, skipped: 0, failed: 0 };
	let planIndex = 0;
	for (const target of targets) {
		if (!isTargetProcessable(target, aggressive)) {
			accumulateResult(totals, skipInactiveTarget(target, aggressive));
			continue;
		}
		const planned = plan[planIndex];
		planIndex++;
		if (planned === undefined) {
			throw new Error('Internal error: planned target missing after partition.');
		}
		accumulateResult(
			totals,
			processTarget(
				planned,
				config.defaultRetention ?? DEFAULT_RETENTION,
				options.apply,
				aggressive,
				fsAdapter,
				options.olderThanDays,
			),
		);
	}
	return totals;
};

export const run = (fsAdapter: FilesystemAdapter = defaultFilesystemAdapter): number => {
	const options = parseArgs();
	if (options.help) {
		console.log(HELP_TEXT);
		return 0;
	}
	let config: Config =
		options.configPath === undefined ? loadBundledConfig() : loadConfig(options.configPath);
	const agentSelection =
		options.agentSelections === undefined
			? undefined
			: resolveAgentSelection(config, options.agentSelections);
	if (agentSelection !== undefined) {
		config = agentSelection.restricted;
	}
	const aggressive = options.aggressive || config.aggressive === true;
	validateAggressiveOptions(options, aggressive);
	logRunMode(options, aggressive);
	if (agentSelection !== undefined) {
		logAgentSelection(agentSelection.selected);
	}

	const targets = assembleTargets(config, aggressive);
	if (targets.length === 0) {
		console.log('No cleanup targets configured.');
		return 0;
	}

	const totals = processConfiguredTargets(targets, config, options, aggressive, fsAdapter);
	console.log(
		`\nCleanup complete. Matched for deletion: ${totals.matched}. ` +
			`Skipped: ${totals.skipped}. Failed or refused: ${totals.failed}.`,
	);
	return totals.failed === 0 ? 0 : 1;
};
