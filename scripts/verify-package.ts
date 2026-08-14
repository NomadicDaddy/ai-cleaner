// Package verification: prove the published tarball (not dist/) is the artifact users receive.
//
// Creates one disposable directory, packs into it with `bun pm pack`, extracts the tarball,
// asserts required contents (and forbids development artifacts), runs the packed entry point
// from an external working directory, then removes only the directory this script created.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dir, '..');

interface RunResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

const runCommand = async (command: string[], cwd: string): Promise<RunResult> => {
	const handle = Bun.spawn(command, {
		cwd,
		stderr: 'pipe',
		stdout: 'pipe',
	});
	const [exitCode, stderr, stdout] = await Promise.all([
		handle.exited,
		new Response(handle.stderr).text(),
		new Response(handle.stdout).text(),
	]);
	return { exitCode, stderr, stdout };
};

const collectRuntimeModules = (srcDir: string): string[] => {
	const modules: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(absolute);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith('.ts')) {
				const relative = path.relative(repositoryRoot, absolute).split(path.sep).join('/');
				modules.push(relative);
			}
		}
	};
	walk(srcDir);
	modules.sort();
	return modules;
};

const listTarballPaths = async (tarballPath: string, cwd: string): Promise<string[]> => {
	// Pass the basename only: GNU tar parses a drive-letter absolute path (C:\...) as a remote
	// host spec, while the spawn cwd keeps the archive reachable under both GNU and bsdtar.
	const result = await runCommand(['tar', '-tzf', path.basename(tarballPath)], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`tar -tzf failed (${result.exitCode}):\n${result.stderr}`);
	}
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/\\/g, '/'));
};

const FORBIDDEN_ARCHIVE_PREFIXES = [
	'package/.aidd',
	'package/dist',
	'package/test',
	'package/test-harness',
	'package/scripts',
	'package/node_modules',
	'package/.githooks',
];

const FORBIDDEN_ARCHIVE_EXACT = new Set([
	'package/eslint.config.js',
	'package/tsconfig.json',
	'package/bun.lock',
	'package/TODO.md',
]);

const isForbiddenArchiveEntry = (entry: string): boolean => {
	const bare = entry.replace(/\/$/, '');
	if (FORBIDDEN_ARCHIVE_EXACT.has(bare)) {
		return true;
	}
	return FORBIDDEN_ARCHIVE_PREFIXES.some(
		(prefix) => bare === prefix || bare.startsWith(`${prefix}/`)
	);
};

const assertRequiredArchiveEntries = (normalized: Set<string>, runtimeModules: string[]): void => {
	const required = [
		'package/LICENSE',
		'package/README.md',
		'package/config.json',
		'package/index.ts',
		...runtimeModules.map((modulePath) => `package/${modulePath}`),
	];
	const missing = required.filter((entry) => !normalized.has(entry));
	if (missing.length > 0) {
		throw new Error(`packed archive missing required files:\n${missing.join('\n')}`);
	}
};

const assertArchiveContents = (archivePaths: string[], runtimeModules: string[]): void => {
	const normalized = new Set(archivePaths.map((entry) => entry.replace(/\/$/, '')));
	assertRequiredArchiveEntries(normalized, runtimeModules);
	const forbiddenHits = archivePaths.filter(isForbiddenArchiveEntry);
	if (forbiddenHits.length > 0) {
		throw new Error(
			`packed archive contains development artifacts:\n${forbiddenHits.join('\n')}`
		);
	}
};

const resolveTarballPath = (packDir: string, packStdout: string): string => {
	const printed = packStdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const named = printed.find((line) => line.endsWith('.tgz'));
	if (named !== undefined) {
		const candidate = path.isAbsolute(named) ? named : path.join(packDir, path.basename(named));
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	const candidates = fs.readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
	if (candidates.length !== 1) {
		throw new Error(
			`expected exactly one tarball in ${packDir}; found: ${candidates.join(', ') || '(none)'}; pack stdout:\n${packStdout}`
		);
	}
	return path.join(packDir, candidates[0]!);
};

const packTarball = async (packDir: string): Promise<string> => {
	const result = await runCommand(
		['bun', 'pm', 'pack', '--destination', packDir, '--quiet'],
		repositoryRoot
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`bun pm pack failed (${result.exitCode}):\n${result.stderr}\n${result.stdout}`
		);
	}
	return resolveTarballPath(packDir, result.stdout);
};

const extractTarball = async (
	tarballPath: string,
	extractDir: string,
	tempRoot: string
): Promise<string> => {
	fs.mkdirSync(extractDir, { recursive: true });
	// Relative POSIX operands only: GNU tar parses drive-letter absolute paths (C:\...) as
	// remote host specs or backslash escape sequences. Spawning from the shared temp root
	// keeps both the archive and the -C target relative under GNU and bsdtar alike.
	const relTarball = path.relative(tempRoot, tarballPath).split(path.sep).join('/');
	const relExtract = path.relative(tempRoot, extractDir).split(path.sep).join('/');
	const result = await runCommand(['tar', '-xzf', relTarball, '-C', relExtract], tempRoot);
	if (result.exitCode !== 0) {
		throw new Error(`tar extract failed (${result.exitCode}):\n${result.stderr}`);
	}
	const packageDir = path.join(extractDir, 'package');
	if (!fs.existsSync(packageDir)) {
		throw new Error(`extracted package directory missing at ${packageDir}`);
	}
	return packageDir;
};

const runPacked = async (
	entryPoint: string,
	args: string[],
	cwd: string,
	env?: NodeJS.ProcessEnv
): Promise<RunResult> => {
	const handle = Bun.spawn([process.execPath, '--no-env-file', entryPoint, ...args], {
		cwd,
		...(env !== undefined ? { env } : {}),
		stderr: 'pipe',
		stdout: 'pipe',
	});
	const [exitCode, stderr, stdout] = await Promise.all([
		handle.exited,
		new Response(handle.stderr).text(),
		new Response(handle.stdout).text(),
	]);
	return { exitCode, stderr, stdout };
};

const verifyHelp = async (entryPoint: string, cwd: string): Promise<void> => {
	const result = await runPacked(entryPoint, ['--help'], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`packed --help exited ${result.exitCode}; stderr:\n${result.stderr}`);
	}
	if (!result.stdout.includes('AI Cleaner')) {
		throw new Error(`packed --help output missing help marker; stdout:\n${result.stdout}`);
	}
};

const verifyDryRun = async (entryPoint: string, cwd: string): Promise<void> => {
	const result = await runPacked(entryPoint, [], cwd);
	if (result.exitCode !== 0) {
		throw new Error(
			`packed bare invocation exited ${result.exitCode}; stderr:\n${result.stderr}`
		);
	}
	if (!result.stdout.includes('DRY RUN MODE ENABLED')) {
		throw new Error(`packed bare invocation missing dry-run marker; stdout:\n${result.stdout}`);
	}
	if (!result.stdout.includes('Cleanup complete.')) {
		throw new Error(`packed bare invocation missing summary marker; stdout:\n${result.stdout}`);
	}
};

const DOTENV_PROBE_VAR = 'AI_CLEANER_PACKAGE_VERIFY_ROOT';

const envWithout = (name: string, assign?: Record<string, string>): NodeJS.ProcessEnv => {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env[name];
	if (assign !== undefined) {
		Object.assign(env, assign);
	}
	return env;
};

/** Packed CLI must ignore cwd .env while still expanding explicit OS environment values. */
const verifyDotenvIsolation = async (entryPoint: string, cwd: string): Promise<void> => {
	const poisonRoot = path.join(cwd, 'poison-from-dotenv');
	const realRoot = path.join(cwd, 'real-os-root');
	fs.mkdirSync(poisonRoot, { recursive: true });
	fs.mkdirSync(realRoot, { recursive: true });
	fs.writeFileSync(path.join(cwd, '.env'), `${DOTENV_PROBE_VAR}=${poisonRoot}\n`);

	const configPath = path.join(cwd, 'dotenv-probe.json');
	fs.writeFileSync(
		configPath,
		JSON.stringify({
			defaultRetention: { keepCount: 5 },
			targets: [
				{
					kind: 'directory',
					name: 'Dotenv probe',
					paths: [`$${DOTENV_PROBE_VAR}`],
					retention: { keepCount: 5 },
					tool: 'verify',
				},
			],
		})
	);

	const ignored = await runPacked(
		entryPoint,
		['--config', configPath],
		cwd,
		envWithout(DOTENV_PROBE_VAR)
	);
	if (ignored.exitCode === 0) {
		throw new Error(
			`packed dotenv isolation expected unavailable-variable failure; stdout:\n${ignored.stdout}\nstderr:\n${ignored.stderr}`
		);
	}
	if (!ignored.stderr.includes('unavailable environment variable')) {
		throw new Error(
			`packed dotenv isolation missing expansion error; stderr:\n${ignored.stderr}`
		);
	}
	if (!ignored.stderr.includes(DOTENV_PROBE_VAR)) {
		throw new Error(
			`packed dotenv isolation missing variable name; stderr:\n${ignored.stderr}`
		);
	}

	const expanded = await runPacked(
		entryPoint,
		['--config', configPath],
		cwd,
		envWithout(DOTENV_PROBE_VAR, { [DOTENV_PROBE_VAR]: realRoot })
	);
	if (expanded.exitCode !== 0) {
		throw new Error(
			`packed OS env expansion exited ${expanded.exitCode}; stderr:\n${expanded.stderr}`
		);
	}
	if (!expanded.stdout.includes('DRY RUN MODE ENABLED')) {
		throw new Error(
			`packed OS env expansion missing dry-run marker; stdout:\n${expanded.stdout}`
		);
	}
	if (expanded.stdout.includes(poisonRoot)) {
		throw new Error(
			`packed run still resolved dotenv poison root; stdout:\n${expanded.stdout}`
		);
	}
};

const main = async (): Promise<void> => {
	const srcDir = path.join(repositoryRoot, 'src');
	if (!fs.existsSync(srcDir)) {
		throw new Error(`src/ directory missing at ${srcDir}`);
	}
	const runtimeModules = collectRuntimeModules(srcDir);
	if (runtimeModules.length === 0) {
		throw new Error('no runtime modules discovered under src/');
	}

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cleaner-verify-package-'));
	try {
		const packDir = path.join(tempDir, 'pack');
		const extractDir = path.join(tempDir, 'extract');
		const externalCwd = path.join(tempDir, 'external-cwd');
		fs.mkdirSync(packDir, { recursive: true });
		fs.mkdirSync(externalCwd, { recursive: true });

		const tarballPath = await packTarball(packDir);
		const archivePaths = await listTarballPaths(tarballPath, packDir);
		assertArchiveContents(archivePaths, runtimeModules);

		const packageDir = await extractTarball(tarballPath, extractDir, tempDir);
		const entryPoint = path.join(packageDir, 'index.ts');
		if (!fs.existsSync(entryPoint)) {
			throw new Error(`packed entry point missing at ${entryPoint}`);
		}

		await verifyHelp(entryPoint, externalCwd);
		await verifyDryRun(entryPoint, externalCwd);
		await verifyDotenvIsolation(entryPoint, externalCwd);
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}

	console.log(
		'Package verification passed: packed archive contents, external-cwd --help/dry-run, and dotenv isolation.'
	);
};

await main();
