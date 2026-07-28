// Build verification: prove the bundled executable runs from a working directory
// outside the repository, loading its bundled defaults rather than local files.
//
// The script creates a single disposable temporary directory, runs
// dist/ai-cleaner.js --help and a bare invocation from that directory, asserts the
// expected exit codes and output markers, and removes only the directory it created.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dir, '..');
const bundlePath = path.join(repositoryRoot, 'dist', 'ai-cleaner.js');

interface RunResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

const runBundle = async (args: string[], cwd: string): Promise<RunResult> => {
	if (!fs.existsSync(bundlePath)) {
		throw new Error(
			`dist/ai-cleaner.js does not exist. Run "bun run build:bundle" before verification.`
		);
	}
	const handle = Bun.spawn([process.execPath, '--no-env-file', bundlePath, ...args], {
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

const verifyHelp = async (cwd: string): Promise<void> => {
	const result = await runBundle(['--help'], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`--help exited ${result.exitCode}; stderr:\n${result.stderr}`);
	}
	if (!result.stdout.includes('AI Cleaner')) {
		throw new Error(`--help output missing help marker; stdout:\n${result.stdout}`);
	}
};

const verifyDryRun = async (cwd: string): Promise<void> => {
	const result = await runBundle([], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`bare invocation exited ${result.exitCode}; stderr:\n${result.stderr}`);
	}
	if (!result.stdout.includes('DRY RUN MODE ENABLED')) {
		throw new Error(`bare invocation missing dry-run marker; stdout:\n${result.stdout}`);
	}
	if (!result.stdout.includes('Cleanup complete.')) {
		throw new Error(`bare invocation missing summary marker; stdout:\n${result.stdout}`);
	}
};

const main = async (): Promise<void> => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cleaner-verify-'));
	try {
		await verifyHelp(tempDir);
		await verifyDryRun(tempDir);
	} finally {
		fs.rmSync(tempDir, { force: true, recursive: true });
	}
	console.log('Build verification passed: --help and bundled-default dry-run from external cwd.');
};

await main();
