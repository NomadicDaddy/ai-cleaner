import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

const normalizeForCompare = (p: string): string => {
	const resolved = path.resolve(p);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const DANGEROUS_ROOTS: Set<string> = (() => {
	const roots = new Set<string>();
	const add = (p: string) => roots.add(normalizeForCompare(p));
	if (process.platform === 'win32') {
		for (const drive of ['C:\\', 'D:\\', 'E:\\']) {
			add(drive);
		}
		add('C:\\Windows');
		add('C:\\Windows\\System32');
		add('C:\\Program Files');
		add('C:\\Program Files (x86)');
		add('C:\\Users');
		add('C:\\ProgramData');
	} else {
		for (const root of [
			'/',
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
			add(root);
		}
	}
	add(os.homedir());
	return roots;
})();

const isDangerousRoot = (candidatePath: string): boolean =>
	DANGEROUS_ROOTS.has(normalizeForCompare(candidatePath));

const HELP_TEXT = `AI Cleaner - routine harness/session cleanup with retention policies.

Usage:
  bun index.ts [options]

Options:
  --config <path>   Path to config JSON (default: config.json)
  --dry-run         Print actions without deleting
  --aggressive      Process targets marked risk: aggressive
  --help, -h        Show this help

See config.example.json for configuration format.`;

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
	const options = {
		aggressive: false,
		configPath: 'config.json',
		dryRun: false,
		help: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--dry-run') {
			options.dryRun = true;
		} else if (arg === '--aggressive') {
			options.aggressive = true;
		} else if (arg === '--config') {
			const next = args[i + 1];
			if (next === undefined) {
				console.error('--config requires a path argument');
				console.error(HELP_TEXT);
				process.exit(2);
			}
			options.configPath = next;
			i++;
		} else if (arg === '--help' || arg === '-h') {
			options.help = true;
		} else {
			console.error(`Unknown argument: ${arg}`);
			console.error(HELP_TEXT);
			process.exit(2);
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
	let raw: string;
	try {
		raw = fs.readFileSync(fullPath, 'utf8');
	} catch (error) {
		console.error(`Failed to read config ${fullPath}: ${(error as Error).message}`);
		process.exit(1);
	}
	try {
		return JSON.parse(raw) as Config;
	} catch (error) {
		console.error(`Invalid JSON in ${fullPath}: ${(error as Error).message}`);
		process.exit(1);
	}
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
	if (policy.keepCount === 0 && policy.allowEmpty !== true) {
		throw new Error(
			`${label}.keepCount is 0 (would delete all matching artifacts). Set allowEmpty: true on the policy to confirm.`
		);
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

	let rootStats: fs.Stats;
	try {
		rootStats = fs.statSync(rootPath);
	} catch (error) {
		console.warn(`Cannot stat ${rootPath}: ${(error as Error).message}`);
		return [];
	}

	if (!rootStats.isDirectory()) {
		const artifact = {
			path: rootPath,
			time: rootStats.mtimeMs,
			isDirectory: rootStats.isDirectory(),
			isFile: rootStats.isFile(),
		};
		return matchesKind(artifact, kind) ? [artifact] : [];
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(rootPath, { withFileTypes: true });
	} catch (error) {
		console.warn(`Cannot read ${rootPath}: ${(error as Error).message}`);
		return [];
	}

	const artifacts: Artifact[] = [];
	for (const dirent of entries) {
		const artifactPath = path.join(rootPath, dirent.name);
		try {
			const stats = fs.statSync(artifactPath);
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
			console.warn(`Cannot stat ${artifactPath}: ${(error as Error).message}`);
		}
	}

	return artifacts.sort((a, b) => b.time - a.time);
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
		if (isDangerousRoot(rootPath)) {
			console.warn(`Refusing to operate on dangerous root: ${rootPath}`);
			result.skipped++;
			continue;
		}
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
			if (isDangerousRoot(artifact.path)) {
				console.warn(`Skipping dangerous path: ${artifact.path}`);
				result.skipped++;
				continue;
			}
			if (dryRun) {
				console.log(`[DRY RUN] Would delete: ${artifact.path}`);
				result.matched++;
			} else {
				try {
					console.log(`Deleting: ${artifact.path}`);
					fs.rmSync(artifact.path, { recursive: true, force: true });
					result.matched++;
				} catch (error) {
					console.error(`Failed to delete ${artifact.path}: ${(error as Error).message}`);
					result.skipped++;
				}
			}
		}
	}

	return result;
};

const legacyTargetsFromConfig = (config: Config, explicitPaths: Set<string>): CleanupTarget[] => {
	const targets: CleanupTarget[] = [];
	for (const targetPath of config.targetPaths || []) {
		const fullPath = path.resolve(process.cwd(), targetPath);
		if (!fs.existsSync(fullPath)) {
			console.warn(`Target path does not exist: ${fullPath}`);
			continue;
		}
		if (isDangerousRoot(fullPath)) {
			console.warn(`Refusing to enumerate dangerous root: ${fullPath}`);
			continue;
		}

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(fullPath, { withFileTypes: true });
		} catch (error) {
			console.warn(`Cannot read ${fullPath}: ${(error as Error).message}`);
			continue;
		}

		for (const dirent of entries) {
			if (!dirent.isDirectory()) continue;
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
					config.overrides?.[dirent.name] || config.defaultRetention || DEFAULT_RETENTION,
			});
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
	if (options.help) {
		console.log(HELP_TEXT);
		return;
	}
	console.log('Starting AI Cleaner...');
	if (options.dryRun) {
		console.log('*** DRY RUN MODE ENABLED ***');
	}

	const config = loadConfig(options.configPath);
	validateConfig(config);

	const aggressive = options.aggressive || config.aggressive === true;
	const defaultRetention = config.defaultRetention || DEFAULT_RETENTION;
	const explicitTargets = [...presetTargetsFromConfig(config), ...(config.targets || [])];
	const explicitPaths = new Set(
		explicitTargets.flatMap((t) => t.paths.map((p) => normalizeForCompare(expandPath(p))))
	);
	const targets = [...explicitTargets, ...legacyTargetsFromConfig(config, explicitPaths)];
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
