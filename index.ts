import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type ArtifactKind = 'directory' | 'file' | 'any';
type RiskLevel = 'normal' | 'aggressive';

interface RetentionPolicy {
	keepCount?: number;
	keepDays?: number;
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

const DEFAULT_RETENTION: RetentionPolicy = { keepCount: 5 };

const SENSITIVE_NAME_PATTERNS = [
	/(^|[\\/])\.env($|[\\/.\w-])/i,
	/(^|[\\/])\.git($|[\\/])/i,
	/(^|[\\/])\.ssh($|[\\/])/i,
	/(^|[\\/])(settings|config|rules|prompts?|instructions?|credentials?|secrets?|keys?|mcp)(\.[\w-]+)?$/i,
	/(^|[\\/]).*(credential|secret|token|apikey|api-key|private-key|id_rsa).*$/i,
];

const PRESETS: Record<string, CleanupTarget[]> = {
	'claude-code': [
		{
			name: 'Claude Code project sessions',
			tool: 'claude-code',
			paths: ['./.claude/sessions'],
		},
		{
			name: 'Claude Code global sessions and logs',
			tool: 'claude-code',
			paths: ['~/.claude/projects', '~/.claude/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	codex: [
		{
			name: 'Codex project sessions',
			tool: 'codex',
			paths: ['./.codex/sessions'],
		},
		{
			name: 'Codex global sessions, cache, and logs',
			tool: 'codex',
			paths: ['~/.codex/sessions', '~/.codex/cache', '~/.codex/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	kilocode: [
		{
			name: 'Kilocode project task history',
			tool: 'kilocode',
			paths: ['./.kilocode/tasks'],
		},
		{
			name: 'Kilocode global tasks, cache, and logs',
			tool: 'kilocode',
			paths: ['~/.kilocode/tasks', '~/.kilocode/cache', '~/.kilocode/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	opencode: [
		{
			name: 'OpenCode project sessions',
			tool: 'opencode',
			paths: ['./.opencode/sessions'],
		},
		{
			name: 'OpenCode global sessions, cache, and logs',
			tool: 'opencode',
			paths: ['~/.opencode/sessions', '~/.opencode/cache', '~/.opencode/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	kiro: [
		{
			name: 'Kiro project run artifacts',
			tool: 'kiro',
			paths: ['./.kiro/runs', './.kiro/history'],
		},
		{
			name: 'Kiro global runs, cache, and logs',
			tool: 'kiro',
			paths: ['~/.kiro/runs', '~/.kiro/cache', '~/.kiro/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	cursor: [
		{
			name: 'Cursor agent history',
			tool: 'cursor',
			paths: ['./.cursor/history', './.cursor/sessions'],
		},
		{
			name: 'Cursor cache and logs',
			tool: 'cursor',
			paths: ['~/AppData/Roaming/Cursor/logs', '~/AppData/Roaming/Cursor/CachedData'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	cline: [
		{
			name: 'Cline project task history',
			tool: 'cline',
			paths: ['./.cline/tasks'],
		},
		{
			name: 'Cline global tasks, cache, and logs',
			tool: 'cline',
			paths: ['~/.cline/tasks', '~/.cline/cache', '~/.cline/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	windsurf: [
		{
			name: 'Windsurf project sessions',
			tool: 'windsurf',
			paths: ['./.windsurf/sessions'],
		},
		{
			name: 'Windsurf global sessions, cache, and logs',
			tool: 'windsurf',
			paths: ['~/.windsurf/sessions', '~/.windsurf/cache', '~/.windsurf/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
	antigravity: [
		{
			name: 'Antigravity project sessions',
			tool: 'antigravity',
			paths: ['./.antigravity/sessions'],
		},
		{
			name: 'Antigravity global sessions, cache, and logs',
			tool: 'antigravity',
			paths: ['~/.antigravity/sessions', '~/.antigravity/cache', '~/.antigravity/logs'],
			kind: 'any',
			risk: 'aggressive',
		},
	],
};

const parseArgs = () => {
	const args = process.argv.slice(2);
	const options = { aggressive: false, configPath: 'config.json', dryRun: false };

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--dry-run') {
			options.dryRun = true;
		} else if (args[i] === '--aggressive') {
			options.aggressive = true;
		} else if (args[i] === '--config' && i + 1 < args.length) {
			options.configPath = args[i + 1];
			i++;
		}
	}

	return options;
};

const loadConfig = (configPath: string): Config => {
	const fullPath = path.resolve(process.cwd(), configPath);
	if (!fs.existsSync(fullPath)) {
		console.error(`Config file not found: ${fullPath}`);
		process.exit(1);
	}
	return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Config;
};

const validateRetentionPolicy = (policy: RetentionPolicy, label: string) => {
	if (policy.keepCount === undefined && policy.keepDays === undefined) {
		throw new Error(`${label} must define keepCount or keepDays.`);
	}
	if (policy.keepCount !== undefined && policy.keepDays !== undefined) {
		throw new Error(`${label} must not define both keepCount and keepDays.`);
	}
	if (
		policy.keepCount !== undefined &&
		(!Number.isInteger(policy.keepCount) || policy.keepCount < 0)
	) {
		throw new Error(`${label}.keepCount must be a non-negative integer.`);
	}
	if (
		policy.keepDays !== undefined &&
		(!Number.isFinite(policy.keepDays) || policy.keepDays < 0)
	) {
		throw new Error(`${label}.keepDays must be a non-negative number.`);
	}
};

const validateConfig = (config: Config) => {
	validateRetentionPolicy(config.defaultRetention || DEFAULT_RETENTION, 'defaultRetention');
	for (const [name, policy] of Object.entries(config.overrides || {})) {
		validateRetentionPolicy(policy, `overrides.${name}`);
	}
	for (const target of config.targets || []) {
		if (
			!target.name ||
			!target.tool ||
			!Array.isArray(target.paths) ||
			target.paths.length === 0
		) {
			throw new Error('Each target must define name, tool, and at least one path.');
		}
		if (target.retention) {
			validateRetentionPolicy(target.retention, `targets.${target.name}.retention`);
		}
	}
};

const expandPath = (inputPath: string): string => {
	let expanded = inputPath;
	if (expanded === '~' || expanded.startsWith('~/') || expanded.startsWith('~\\')) {
		expanded = path.join(os.homedir(), expanded.slice(2));
	}
	expanded = expanded.replace(
		/%([^%]+)%/g,
		(_, name: string) => process.env[name] || `%${name}%`
	);
	expanded = expanded.replace(
		/\$([A-Z_][A-Z0-9_]*)/gi,
		(_, name: string) => process.env[name] || `$${name}`
	);
	return path.resolve(process.cwd(), expanded);
};

const isSensitivePath = (candidatePath: string) => {
	const normalized = candidatePath.replace(/\\/g, '/');
	return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
};

const matchesKind = (artifact: Artifact, kind: ArtifactKind) =>
	kind === 'any' || (kind === 'directory' ? artifact.isDirectory : artifact.isFile);

const listArtifacts = (rootPath: string, kind: ArtifactKind): Artifact[] => {
	if (!fs.existsSync(rootPath)) {
		return [];
	}

	const rootStats = fs.statSync(rootPath);
	if (!rootStats.isDirectory()) {
		const artifact = {
			path: rootPath,
			time: rootStats.mtimeMs,
			isDirectory: rootStats.isDirectory(),
			isFile: rootStats.isFile(),
		};
		return matchesKind(artifact, kind) ? [artifact] : [];
	}

	return fs
		.readdirSync(rootPath, { withFileTypes: true })
		.map((dirent) => {
			const artifactPath = path.join(rootPath, dirent.name);
			const stats = fs.statSync(artifactPath);
			return {
				path: artifactPath,
				time: stats.mtimeMs,
				isDirectory: stats.isDirectory(),
				isFile: stats.isFile(),
			};
		})
		.filter((artifact) => matchesKind(artifact, kind))
		.sort((a, b) => b.time - a.time);
};

const selectArtifactsToDelete = (artifacts: Artifact[], policy: RetentionPolicy) => {
	if (policy.keepCount !== undefined) {
		return artifacts.slice(policy.keepCount);
	}
	const now = Date.now();
	const msPerDay = 1000 * 60 * 60 * 24;
	return artifacts.filter((artifact) => (now - artifact.time) / msPerDay > policy.keepDays!);
};

const processTarget = (
	target: CleanupTarget,
	defaultRetention: RetentionPolicy,
	dryRun: boolean,
	aggressive: boolean
) => {
	const policy = target.retention || defaultRetention;
	const kind = target.kind || 'directory';
	const result = { matched: 0, skipped: 0 };

	if (target.enabled === false) {
		console.log(`\nSkipping disabled target: ${target.tool} / ${target.name}`);
		return result;
	}
	if (target.risk === 'aggressive' && !aggressive) {
		console.log(`\nSkipping aggressive target: ${target.tool} / ${target.name}`);
		return result;
	}

	console.log(`\nAnalyzing ${target.tool} / ${target.name}...`);
	console.log(`Policy: ${JSON.stringify(policy)}`);

	for (const configuredPath of target.paths) {
		const rootPath = expandPath(configuredPath);
		const artifacts = listArtifacts(rootPath, kind);
		if (artifacts.length === 0) {
			console.log(`No matching artifacts under: ${rootPath}`);
			continue;
		}

		const toDelete = selectArtifactsToDelete(artifacts, policy);
		if (toDelete.length === 0) {
			console.log(`No artifacts to clean under: ${rootPath}`);
			continue;
		}

		for (const artifact of toDelete) {
			if (isSensitivePath(artifact.path)) {
				console.warn(`Skipping sensitive path: ${artifact.path}`);
				result.skipped++;
				continue;
			}
			if (dryRun) {
				console.log(`[DRY RUN] Would delete: ${artifact.path}`);
			} else {
				console.log(`Deleting: ${artifact.path}`);
				fs.rmSync(artifact.path, { recursive: true, force: true });
			}
			result.matched++;
		}
	}

	return result;
};

const legacyTargetsFromConfig = (config: Config): CleanupTarget[] => {
	const targets: CleanupTarget[] = [];
	for (const targetPath of config.targetPaths || []) {
		const fullPath = path.resolve(process.cwd(), targetPath);
		if (!fs.existsSync(fullPath)) {
			console.warn(`Target path does not exist: ${fullPath}`);
			continue;
		}

		for (const dirent of fs.readdirSync(fullPath, { withFileTypes: true })) {
			if (dirent.isDirectory()) {
				targets.push({
					name: `${dirent.name} legacy artifacts`,
					tool: dirent.name,
					paths: [path.join(targetPath, dirent.name)],
					retention:
						config.overrides?.[dirent.name] ||
						config.defaultRetention ||
						DEFAULT_RETENTION,
				});
			}
		}
	}
	return targets;
};

const presetTargetsFromConfig = (config: Config): CleanupTarget[] => {
	return (config.usePresets || []).flatMap((presetName) => {
		const preset = PRESETS[presetName];
		if (!preset) {
			console.warn(`Unknown preset: ${presetName}`);
			return [];
		}
		return preset;
	});
};

const main = () => {
	const options = parseArgs();
	console.log('Starting AI Cleaner...');
	if (options.dryRun) {
		console.log('*** DRY RUN MODE ENABLED ***');
	}

	const config = loadConfig(options.configPath);
	validateConfig(config);

	const aggressive = options.aggressive || config.aggressive === true;
	const defaultRetention = config.defaultRetention || DEFAULT_RETENTION;
	const targets = [
		...presetTargetsFromConfig(config),
		...(config.targets || []),
		...legacyTargetsFromConfig(config),
	];
	const totals = { matched: 0, skipped: 0 };

	if (aggressive) {
		console.log('*** AGGRESSIVE CLEANUP ENABLED ***');
	}
	if (targets.length === 0) {
		console.log('No cleanup targets configured.');
		return;
	}

	for (const target of targets) {
		const result = processTarget(target, defaultRetention, options.dryRun, aggressive);
		totals.matched += result.matched;
		totals.skipped += result.skipped;
	}

	console.log(
		`\nCleanup complete. Matched for deletion: ${totals.matched}. Skipped: ${totals.skipped}.`
	);
};

main();
