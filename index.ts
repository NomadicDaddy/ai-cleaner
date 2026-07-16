#!/usr/bin/env bun

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import bundledConfig from './config.json' with { type: 'json' };

type ArtifactKind = 'directory' | 'file' | 'any';
type RiskLevel = 'normal' | 'aggressive';

interface RetentionPolicy {
	keepCount?: number;
	keepDays?: number;
	allowEmpty?: boolean;
}

interface CleanupTarget {
	name: string;
	tool: string;
	paths: string[];
	kind?: ArtifactKind;
	retention?: RetentionPolicy;
	enabled?: boolean;
	risk?: RiskLevel;
}

interface Config {
	aggressive?: boolean;
	defaultRetention?: RetentionPolicy;
	overrides?: Record<string, RetentionPolicy>;
	presets?: Record<string, CleanupTarget[]>;
	targetPaths?: string[];
	targets?: CleanupTarget[];
	usePresets?: string[];
}

interface Artifact {
	path: string;
	time: number;
	isDirectory: boolean;
	isFile: boolean;
}

interface PlannedRoot {
	configuredPath: string;
	resolvedPath: string;
	canonicalPath: string;
	label: string;
}

interface PlannedTarget {
	target: CleanupTarget;
	roots: PlannedRoot[];
}

interface ProcessResult {
	matched: number;
	skipped: number;
	failed: number;
}

interface CliOptions {
	aggressive: boolean;
	apply: boolean;
	confirmAggressive: boolean;
	configPath?: string;
	help: boolean;
}

const DEFAULT_RETENTION: RetentionPolicy = { keepCount: 5 };
const ARTIFACT_KINDS = new Set<ArtifactKind>(['directory', 'file', 'any']);
const RISK_LEVELS = new Set<RiskLevel>(['normal', 'aggressive']);

const SENSITIVE_NAME_PATTERNS = [
	/(^|[\\/])\.env($|[\\/.\w-])/i,
	/(^|[\\/])\.git($|[\\/])/i,
	/(^|[\\/])\.ssh($|[\\/])/i,
	/(^|[\\/])(agents?|skills?|plugins?|memories|rules|auth|database)(\.[\w-]+)?$/i,
	/(^|[\\/])(settings|config|rules|prompts?|instructions?|credentials?|secrets?|keys?|mcp)(\.[\w-]+)?$/i,
	/(^|[\\/]).*(credential|secret|token|apikey|api-key|private-key|id_rsa).*$/i,
];

const normalizeForCompare = (candidatePath: string): string => {
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

const HELP_TEXT = `AI Cleaner - routine harness/session cleanup with retention policies.

Usage:
  ai-cleaner [options]

Options:
  --config <path>         Path to config JSON (default: bundled config.json)
  --dry-run               Print actions without deleting (default)
  --apply                 Delete selected artifacts
  --aggressive            Process targets marked risk: aggressive
  --confirm-aggressive    Confirm aggressive deletion (required with --apply --aggressive)
  --help, -h              Show this help

See config.json and README.md for the configuration format.`;

class CliError extends Error {}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
	if (!isRecord(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value;
};

const assertAllowedKeys = (
	value: Record<string, unknown>,
	allowedKeys: readonly string[],
	label: string
): void => {
	const allowed = new Set(allowedKeys);
	const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
	if (unknownKey !== undefined) {
		throw new Error(`${label} contains unknown field: ${unknownKey}.`);
	}
};

const parseNonEmptyString = (value: unknown, label: string): string => {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	return value;
};

const parseBoolean = (value: unknown, label: string): boolean => {
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean.`);
	}
	return value;
};

const parseStringArray = (value: unknown, label: string, allowEmpty = true): string[] => {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
		throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array.`);
	}
	const values = value.map((entry, index) => parseNonEmptyString(entry, `${label}[${index}]`));
	if (new Set(values).size !== values.length) {
		throw new Error(`${label} must not contain duplicate values.`);
	}
	return values;
};

const parseRetentionPolicy = (value: unknown, label: string): RetentionPolicy => {
	const policy = assertRecord(value, label);
	assertAllowedKeys(policy, ['keepCount', 'keepDays', 'allowEmpty'], label);
	const keepCount = policy.keepCount;
	const keepDays = policy.keepDays;
	if (keepCount === undefined && keepDays === undefined) {
		throw new Error(`${label} must define keepCount or keepDays.`);
	}
	if (keepCount !== undefined && keepDays !== undefined) {
		throw new Error(`${label} must not define both keepCount and keepDays.`);
	}
	if (
		keepCount !== undefined &&
		(typeof keepCount !== 'number' || !Number.isInteger(keepCount) || keepCount < 0)
	) {
		throw new Error(`${label}.keepCount must be a non-negative integer.`);
	}
	if (
		keepDays !== undefined &&
		(typeof keepDays !== 'number' || !Number.isFinite(keepDays) || keepDays < 0)
	) {
		throw new Error(`${label}.keepDays must be a non-negative number.`);
	}
	let allowEmpty: boolean | undefined;
	if (policy.allowEmpty !== undefined) {
		allowEmpty = parseBoolean(policy.allowEmpty, `${label}.allowEmpty`);
	}
	if (keepCount === 0 && allowEmpty !== true) {
		throw new Error(
			`${label}.keepCount is 0 (would delete all matching artifacts). ` +
				'Set allowEmpty: true on the policy to confirm.'
		);
	}
	const parsedPolicy: RetentionPolicy = {};
	if (keepCount !== undefined) parsedPolicy.keepCount = keepCount;
	if (keepDays !== undefined) parsedPolicy.keepDays = keepDays;
	if (allowEmpty !== undefined) parsedPolicy.allowEmpty = allowEmpty;
	return parsedPolicy;
};

const isArtifactKind = (value: string): value is ArtifactKind =>
	ARTIFACT_KINDS.has(value as ArtifactKind);

const isRiskLevel = (value: string): value is RiskLevel => RISK_LEVELS.has(value as RiskLevel);

const parseCleanupTarget = (value: unknown, label: string): CleanupTarget => {
	const target = assertRecord(value, label);
	assertAllowedKeys(
		target,
		['name', 'tool', 'paths', 'kind', 'retention', 'enabled', 'risk'],
		label
	);
	const kind = target.kind;
	if (kind !== undefined && (typeof kind !== 'string' || !isArtifactKind(kind))) {
		throw new Error(`${label}.kind must be directory, file, or any.`);
	}
	const risk = target.risk;
	if (risk !== undefined && (typeof risk !== 'string' || !isRiskLevel(risk))) {
		throw new Error(`${label}.risk must be normal or aggressive.`);
	}
	const parsedTarget: CleanupTarget = {
		name: parseNonEmptyString(target.name, `${label}.name`),
		tool: parseNonEmptyString(target.tool, `${label}.tool`),
		paths: parseStringArray(target.paths, `${label}.paths`, false),
	};
	if (kind !== undefined) parsedTarget.kind = kind;
	if (target.retention !== undefined) {
		parsedTarget.retention = parseRetentionPolicy(target.retention, `${label}.retention`);
	}
	if (target.enabled !== undefined) {
		parsedTarget.enabled = parseBoolean(target.enabled, `${label}.enabled`);
	}
	if (risk !== undefined) parsedTarget.risk = risk;
	return parsedTarget;
};

const parseConfig = (value: unknown): Config => {
	const config = assertRecord(value, 'config');
	assertAllowedKeys(
		config,
		[
			'aggressive',
			'defaultRetention',
			'overrides',
			'presets',
			'targetPaths',
			'targets',
			'usePresets',
		],
		'config'
	);

	let overrides: Record<string, RetentionPolicy> | undefined;
	if (config.overrides !== undefined) {
		const rawOverrides = assertRecord(config.overrides, 'overrides');
		overrides = {};
		for (const [name, policy] of Object.entries(rawOverrides)) {
			parseNonEmptyString(name, 'overrides key');
			overrides[name] = parseRetentionPolicy(policy, `overrides.${name}`);
		}
	}

	let presets: Record<string, CleanupTarget[]> | undefined;
	if (config.presets !== undefined) {
		const rawPresets = assertRecord(config.presets, 'presets');
		presets = {};
		for (const [name, targets] of Object.entries(rawPresets)) {
			parseNonEmptyString(name, 'presets key');
			if (!Array.isArray(targets)) {
				throw new Error(`presets.${name} must be an array of targets.`);
			}
			presets[name] = targets.map((target, index) =>
				parseCleanupTarget(target, `presets.${name}[${index}]`)
			);
		}
	}

	let targets: CleanupTarget[] | undefined;
	if (config.targets !== undefined) {
		if (!Array.isArray(config.targets)) {
			throw new Error('targets must be an array.');
		}
		targets = config.targets.map((target, index) =>
			parseCleanupTarget(target, `targets[${index}]`)
		);
	}
	let usePresets: string[] | undefined;
	if (config.usePresets !== undefined) {
		usePresets = parseStringArray(config.usePresets, 'usePresets');
	}
	for (const presetName of usePresets ?? []) {
		if (presets?.[presetName] === undefined) {
			throw new Error(`usePresets references unknown preset: ${presetName}.`);
		}
	}

	const parsedConfig: Config = {};
	if (config.aggressive !== undefined) {
		parsedConfig.aggressive = parseBoolean(config.aggressive, 'aggressive');
	}
	if (config.defaultRetention !== undefined) {
		parsedConfig.defaultRetention = parseRetentionPolicy(
			config.defaultRetention,
			'defaultRetention'
		);
	}
	if (overrides !== undefined) parsedConfig.overrides = overrides;
	if (presets !== undefined) parsedConfig.presets = presets;
	if (config.targetPaths !== undefined) {
		parsedConfig.targetPaths = parseStringArray(config.targetPaths, 'targetPaths');
	}
	if (targets !== undefined) parsedConfig.targets = targets;
	if (usePresets !== undefined) parsedConfig.usePresets = usePresets;
	return parsedConfig;
};

const parseArgs = (): CliOptions => {
	const args = process.argv.slice(2);
	const options: CliOptions = {
		aggressive: false,
		apply: false,
		confirmAggressive: false,
		help: false,
	};
	let explicitDryRun = false;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--dry-run') {
			explicitDryRun = true;
		} else if (argument === '--apply') {
			options.apply = true;
		} else if (argument === '--aggressive') {
			options.aggressive = true;
		} else if (argument === '--confirm-aggressive') {
			options.confirmAggressive = true;
		} else if (argument === '--config') {
			const next = args[index + 1];
			if (next === undefined || next.startsWith('-')) {
				throw new CliError('--config requires a path argument.');
			}
			options.configPath = next;
			index++;
		} else if (argument === '--help' || argument === '-h') {
			options.help = true;
		} else {
			throw new CliError(`Unknown argument: ${argument}`);
		}
	}
	if (explicitDryRun && options.apply) {
		throw new CliError('--dry-run and --apply cannot be used together.');
	}
	return options;
};

const loadConfig = (configPath: string): Config => {
	const fullPath = path.resolve(process.cwd(), configPath);
	let raw: string;
	try {
		raw = fs.readFileSync(fullPath, 'utf8');
	} catch (error) {
		throw new Error(`Failed to read config ${fullPath}: ${errorMessage(error)}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON in ${fullPath}: ${errorMessage(error)}`);
	}
	return parseConfig(parsed);
};

const expandPath = (inputPath: string): string => {
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
				`Path references unavailable environment variable ${name}: ${inputPath}`
			);
		}
		return value;
	};
	expanded = expanded.replace(/%([^%]+)%/g, resolveEnvironmentVariable);
	expanded = expanded.replace(/\$([A-Z_][A-Z0-9_]*)/gi, resolveEnvironmentVariable);
	return path.resolve(process.cwd(), expanded);
};

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
		} catch (error) {
			const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
			if (code === 'ENOENT') {
				return;
			}
			throw new Error(`Cannot inspect ${label} ${current}: ${errorMessage(error)}`);
		}
		if (stats.isSymbolicLink()) {
			throw new Error(`${label} traverses a symbolic link or junction: ${current}`);
		}
	}
};

const planRoot = (configuredPath: string, label: string): PlannedRoot => {
	const resolvedPath = expandPath(configuredPath);
	if (isDangerousPath(resolvedPath)) {
		throw new Error(`Refusing dangerous cleanup root for ${label}: ${resolvedPath}`);
	}
	assertPathHasNoLinks(resolvedPath, label);
	let canonicalPath = resolvedPath;
	try {
		canonicalPath = fs.realpathSync.native(resolvedPath);
	} catch (error) {
		const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
		if (code !== 'ENOENT') {
			throw new Error(`Cannot resolve ${label} ${resolvedPath}: ${errorMessage(error)}`);
		}
	}
	if (isDangerousPath(canonicalPath)) {
		throw new Error(`Refusing dangerous canonical root for ${label}: ${canonicalPath}`);
	}
	if (normalizeForCompare(canonicalPath) !== normalizeForCompare(resolvedPath)) {
		throw new Error(`${label} resolves through a symbolic link or junction: ${resolvedPath}`);
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
					`Cleanup roots overlap (${first.label}: ${first.resolvedPath}; ` +
						`${second.label}: ${second.resolvedPath}).`
				);
			}
		}
	}
};

const buildTargetPlan = (targets: CleanupTarget[]): PlannedTarget[] => {
	const plannedTargets = targets.map((target, targetIndex) => ({
		target,
		roots: target.paths.map((configuredPath, pathIndex) =>
			planRoot(configuredPath, `targets[${targetIndex}].paths[${pathIndex}]`)
		),
	}));
	assertNoOverlappingRoots(plannedTargets.flatMap((target) => target.roots));
	return plannedTargets;
};

const matchesKind = (artifact: Artifact, kind: ArtifactKind): boolean =>
	kind === 'any' || (kind === 'directory' ? artifact.isDirectory : artifact.isFile);

const listArtifacts = (
	root: PlannedRoot,
	kind: ArtifactKind
): { artifacts: Artifact[]; failed: number } => {
	let rootStats: fs.Stats;
	try {
		rootStats = fs.lstatSync(root.resolvedPath);
	} catch (error) {
		const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
		if (code === 'ENOENT') {
			return { artifacts: [], failed: 0 };
		}
		console.error(`Cannot inspect ${root.resolvedPath}: ${errorMessage(error)}`);
		return { artifacts: [], failed: 1 };
	}
	if (rootStats.isSymbolicLink()) {
		console.error(`Refusing symbolic link or junction cleanup root: ${root.resolvedPath}`);
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
	} catch (error) {
		console.error(`Cannot read ${root.resolvedPath}: ${errorMessage(error)}`);
		return { artifacts: [], failed: 1 };
	}

	const artifacts: Artifact[] = [];
	let failed = 0;
	for (const dirent of entries) {
		const artifactPath = path.join(root.resolvedPath, dirent.name);
		try {
			const stats = fs.lstatSync(artifactPath);
			if (stats.isSymbolicLink()) {
				console.error(`Refusing symbolic link or junction artifact: ${artifactPath}`);
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
		} catch (error) {
			console.error(`Cannot inspect ${artifactPath}: ${errorMessage(error)}`);
			failed++;
		}
	}
	return { artifacts, failed };
};

const selectArtifactsToDelete = (artifacts: Artifact[], policy: RetentionPolicy): Artifact[] => {
	if (policy.keepCount !== undefined) {
		return artifacts
			.toSorted((first, second) => second.time - first.time)
			.slice(policy.keepCount);
	}
	const cutoff = Date.now() - (policy.keepDays ?? 0) * 24 * 60 * 60 * 1000;
	return artifacts.filter((artifact) => artifact.time < cutoff);
};

const inspectProtectedSubtree = (artifactPath: string): string | undefined => {
	if (isSensitivePath(artifactPath)) {
		return `sensitive path ${artifactPath}`;
	}
	let stats: fs.Stats;
	try {
		stats = fs.lstatSync(artifactPath);
	} catch (error) {
		throw new Error(`Cannot inspect ${artifactPath}: ${errorMessage(error)}`);
	}
	if (stats.isSymbolicLink()) {
		return `symbolic link or junction ${artifactPath}`;
	}
	if (!stats.isDirectory()) {
		return undefined;
	}
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(artifactPath, { withFileTypes: true });
	} catch (error) {
		throw new Error(`Cannot read ${artifactPath}: ${errorMessage(error)}`);
	}
	for (const entry of entries) {
		const protectedDescendant = inspectProtectedSubtree(path.join(artifactPath, entry.name));
		if (protectedDescendant !== undefined) {
			return protectedDescendant;
		}
	}
	return undefined;
};

const revalidateContainment = (root: PlannedRoot, artifactPath: string): void => {
	assertPathHasNoLinks(root.resolvedPath, root.label);
	const currentRoot = fs.realpathSync.native(root.resolvedPath);
	if (normalizeForCompare(currentRoot) !== normalizeForCompare(root.canonicalPath)) {
		throw new Error(`Cleanup root changed after planning: ${root.resolvedPath}`);
	}
	const artifactStats = fs.lstatSync(artifactPath);
	if (artifactStats.isSymbolicLink()) {
		throw new Error(`Artifact became a symbolic link or junction: ${artifactPath}`);
	}
	const currentArtifact = fs.realpathSync.native(artifactPath);
	if (!isWithinOrEqual(normalizeForCompare(currentArtifact), normalizeForCompare(currentRoot))) {
		throw new Error(`Artifact escaped its cleanup root: ${artifactPath}`);
	}
};

const processTarget = (
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
		console.log(`\nSkipping disabled target: ${target.tool} / ${target.name}`);
		result.skipped++;
		return result;
	}
	if (target.risk === 'aggressive' && !aggressive) {
		console.log(`\nSkipping aggressive target: ${target.tool} / ${target.name}`);
		result.skipped++;
		return result;
	}

	console.log(`\nAnalyzing ${target.tool} / ${target.name}...`);
	console.log(`Policy: ${JSON.stringify(policy)}`);

	for (const root of roots) {
		const scan = listArtifacts(root, kind);
		result.failed += scan.failed;
		if (scan.artifacts.length === 0) {
			console.log(`No matching artifacts under: ${root.resolvedPath}`);
			continue;
		}
		const toDelete = selectArtifactsToDelete(scan.artifacts, policy);
		if (toDelete.length === 0) {
			console.log(`No artifacts to clean under: ${root.resolvedPath}`);
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
					console.log(`[DRY RUN] Would delete: ${artifact.path}`);
					result.matched++;
					continue;
				}
				revalidateContainment(root, artifact.path);
				console.log(`Deleting: ${artifact.path}`);
				fs.rmSync(artifact.path, { recursive: true, force: false });
				result.matched++;
			} catch (error) {
				console.error(
					`Refusing or failing to delete ${artifact.path}: ${errorMessage(error)}`
				);
				result.failed++;
			}
		}
	}
	return result;
};

const legacyTargetsFromConfig = (config: Config, explicitPaths: Set<string>): CleanupTarget[] => {
	const targets: CleanupTarget[] = [];
	for (const targetPath of config.targetPaths ?? []) {
		const root = planRoot(targetPath, `targetPaths entry ${targetPath}`);
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(root.resolvedPath, { withFileTypes: true });
		} catch (error) {
			const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
			if (code === 'ENOENT') {
				console.warn(`Target path does not exist: ${root.resolvedPath}`);
				continue;
			}
			throw new Error(`Cannot read ${root.resolvedPath}: ${errorMessage(error)}`);
		}
		for (const dirent of entries) {
			if (!dirent.isDirectory() || dirent.isSymbolicLink()) {
				continue;
			}
			const subPath = path.join(targetPath, dirent.name);
			const expandedSubPath = normalizeForCompare(expandPath(subPath));
			if (explicitPaths.has(expandedSubPath)) {
				console.log(`Skipping legacy entry already covered by explicit target: ${subPath}`);
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

const presetTargetsFromConfig = (config: Config): CleanupTarget[] => {
	const presets = config.presets ?? {};
	const selected = config.usePresets ?? Object.keys(presets);
	return selected.flatMap((presetName) => presets[presetName] ?? []);
};

const run = (): number => {
	const options = parseArgs();
	if (options.help) {
		console.log(HELP_TEXT);
		return 0;
	}
	const config =
		options.configPath === undefined
			? parseConfig(bundledConfig)
			: loadConfig(options.configPath);
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
	const plan = buildTargetPlan(targets);
	const totals: ProcessResult = { matched: 0, skipped: 0, failed: 0 };
	for (const target of plan) {
		const result = processTarget(
			target,
			config.defaultRetention ?? DEFAULT_RETENTION,
			options.apply,
			aggressive
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

const isMainModule =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
	try {
		process.exitCode = run();
	} catch (error) {
		console.error(errorMessage(error));
		if (error instanceof CliError) {
			console.error(HELP_TEXT);
			process.exitCode = 2;
		} else {
			process.exitCode = 1;
		}
	}
}
