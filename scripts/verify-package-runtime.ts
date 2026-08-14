// Package verification runtime helpers: packed-process execution and the
// --help, bare dry-run, and dotenv-isolation probes driven against the
// extracted tarball from an external working directory.

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RunResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

export const runCommand = async (command: string[], cwd: string): Promise<RunResult> => {
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

export const runPacked = async (
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

export const verifyHelp = async (entryPoint: string, cwd: string): Promise<void> => {
	const result = await runPacked(entryPoint, ['--help'], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`packed --help exited ${result.exitCode}; stderr:\n${result.stderr}`);
	}
	if (!result.stdout.includes('AI Cleaner')) {
		throw new Error(`packed --help output missing help marker; stdout:\n${result.stdout}`);
	}
};

export const verifyDryRun = async (entryPoint: string, cwd: string): Promise<void> => {
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

export const envWithout = (name: string, assign?: Record<string, string>): NodeJS.ProcessEnv => {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env[name];
	if (assign !== undefined) {
		Object.assign(env, assign);
	}
	return env;
};

/** Packed CLI must ignore cwd .env while still expanding explicit OS environment values. */
export const verifyDotenvIsolation = async (entryPoint: string, cwd: string): Promise<void> => {
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
