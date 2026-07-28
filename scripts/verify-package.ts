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
	const result = await runCommand(['tar', '-tzf', tarballPath], cwd);
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

const extractTarball = async (tarballPath: string, extractDir: string): Promise<string> => {
	fs.mkdirSync(extractDir, { recursive: true });
	const result = await runCommand(['tar', '-xzf', tarballPath, '-C', extractDir], extractDir);
	if (result.exitCode !== 0) {
		throw new Error(`tar extract failed (${result.exitCode}):\n${result.stderr}`);
	}
	const packageDir = path.join(extractDir, 'package');
	if (!fs.existsSync(packageDir)) {
		throw new Error(`extracted package directory missing at ${packageDir}`);
	}
	return packageDir;
};

const runPacked = async (entryPoint: string, args: string[], cwd: string): Promise<RunResult> => {
	return runCommand([process.execPath, entryPoint, ...args], cwd);
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

		const packageDir = await extractTarball(tarballPath, extractDir);
		const entryPoint = path.join(packageDir, 'index.ts');
		if (!fs.existsSync(entryPoint)) {
			throw new Error(`packed entry point missing at ${entryPoint}`);
		}

		await verifyHelp(entryPoint, externalCwd);
		await verifyDryRun(entryPoint, externalCwd);
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}

	console.log(
		'Package verification passed: packed archive contents and external-cwd --help/dry-run.'
	);
};

await main();
