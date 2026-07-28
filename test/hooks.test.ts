import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { repositoryRoot } from './cli-fixture.ts';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cleaner-hooks-'));
	temporaryRoots.push(root);
	return root;
};

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

const resolveBash = (): string => {
	if (process.platform === 'win32') {
		const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
		if (fs.existsSync(gitBash)) {
			return gitBash;
		}
	}
	return 'bash';
};

const tagRefLine =
	'refs/tags/v1.2.0 1111111111111111111111111111111111111111 refs/tags/v1.2.0 0000000000000000000000000000000000000000';

const runPrePush = async (
	cwd: string,
	prePushPath: string,
	stdin: string,
	remoteName = 'origin'
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
	const bash = resolveBash();
	// Git Bash on Windows needs a POSIX path for the script; /d/applications/... form works.
	const scriptArg =
		process.platform === 'win32'
			? prePushPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1')
			: prePushPath;
	const processHandle = Bun.spawn(
		[bash, scriptArg, remoteName, 'https://example.invalid/x.git'],
		{
			cwd,
			stderr: 'pipe',
			stdin: new Blob([stdin.endsWith('\n') ? stdin : `${stdin}\n`]),
			stdout: 'pipe',
		}
	);
	const [exitCode, stderr, stdout] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stderr).text(),
		new Response(processHandle.stdout).text(),
	]);
	return { exitCode, stderr, stdout };
};

const writePackageJson = (root: string, scripts: Record<string, string>): void => {
	fs.writeFileSync(
		path.join(root, 'package.json'),
		`${JSON.stringify({ name: 'hooks-fixture', scripts }, null, '\t')}\n`
	);
};

const writeExecutable = (filePath: string, contents: string): void => {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents.replace(/\r\n/g, '\n'), { mode: 0o755 });
};

describe('pre-push screenshot capability gate', () => {
	test('skips the screenshot stage for this CLI on a version-tag push without a bypass flag', async () => {
		const prePushPath = path.join(repositoryRoot, '.githooks', 'pre-push');
		const packageJson = fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8');
		expect(packageJson).not.toMatch(/"smoke:screenshots"\s*:\s*"[^"]+"/);

		const result = await runPrePush(repositoryRoot, prePushPath, tagRefLine);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('pre-push: aidd history guard');
		expect(result.stdout).toContain('screenshot guard: not applicable');
		expect(result.stdout).not.toContain('pre-push: screenshot guard\n');
		expect(result.stdout).toContain('pre-push: passed');
		// Without smoke:screenshots the shared guard must not block the tag.
		expect(result.stderr).not.toContain('PUSH BLOCKED');
		expect(result.stderr).not.toContain('bun run smoke:screenshots');
	});

	test('invokes the AIDD history guard and propagates its exit status', async () => {
		const root = createTemporaryRoot();
		const hooksDir = path.join(root, '.githooks');
		const marker = path.join(root, 'screenshot-guard-ran');
		const historyMarker = path.join(root, 'history-guard-ran');

		writePackageJson(root, { test: 'echo ok' });
		// Use the real wrapper so the capability gate under test is the production script.
		writeExecutable(
			path.join(hooksDir, 'pre-push'),
			fs.readFileSync(path.join(repositoryRoot, '.githooks', 'pre-push'), 'utf8')
		);
		writeExecutable(
			path.join(hooksDir, 'aidd-history-guard.sh'),
			`#!/usr/bin/env bash
set -euo pipefail
touch "${historyMarker.replace(/\\/g, '/')}"
echo "history-guard-stub: remote=\${1:-}"
exit 42
`
		);
		writeExecutable(
			path.join(hooksDir, 'screenshot-guard.sh'),
			`#!/usr/bin/env bash
set -euo pipefail
touch "${marker.replace(/\\/g, '/')}"
echo "screenshot-guard-stub should not run" >&2
exit 1
`
		);

		const result = await runPrePush(
			root,
			path.join(hooksDir, 'pre-push'),
			tagRefLine,
			'origin'
		);

		expect(result.exitCode).toBe(42);
		expect(fs.existsSync(historyMarker)).toBeTrue();
		expect(fs.existsSync(marker)).toBeFalse();
		expect(result.stdout).toContain('pre-push: aidd history guard');
		// History guard failed closed before the screenshot stage; N/A must not claim success.
		expect(result.stdout).not.toContain('screenshot guard: not applicable');
		expect(result.stdout).not.toContain('pre-push: passed');
	});

	test('runs the screenshot guard when package.json defines smoke:screenshots', async () => {
		const root = createTemporaryRoot();
		const hooksDir = path.join(root, '.githooks');
		const marker = path.join(root, 'screenshot-guard-ran');

		writePackageJson(root, { 'smoke:screenshots': 'bun run crawltest:screenshots' });
		writeExecutable(
			path.join(hooksDir, 'pre-push'),
			fs.readFileSync(path.join(repositoryRoot, '.githooks', 'pre-push'), 'utf8')
		);
		writeExecutable(
			path.join(hooksDir, 'aidd-history-guard.sh'),
			`#!/usr/bin/env bash
set -euo pipefail
exit 0
`
		);
		writeExecutable(
			path.join(hooksDir, 'screenshot-guard.sh'),
			`#!/usr/bin/env bash
set -euo pipefail
touch "${marker.replace(/\\/g, '/')}"
exit 0
`
		);

		const result = await runPrePush(root, path.join(hooksDir, 'pre-push'), tagRefLine);

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(marker)).toBeTrue();
		expect(result.stdout).toContain('pre-push: screenshot guard');
		expect(result.stdout).not.toContain('screenshot guard: not applicable');
		expect(result.stdout).toContain('pre-push: passed');
	});

	test('treats an empty smoke:screenshots script as not applicable', async () => {
		const root = createTemporaryRoot();
		const hooksDir = path.join(root, '.githooks');
		const marker = path.join(root, 'screenshot-guard-ran');

		writePackageJson(root, { 'smoke:screenshots': '' });
		writeExecutable(
			path.join(hooksDir, 'pre-push'),
			fs.readFileSync(path.join(repositoryRoot, '.githooks', 'pre-push'), 'utf8')
		);
		writeExecutable(
			path.join(hooksDir, 'aidd-history-guard.sh'),
			`#!/usr/bin/env bash
set -euo pipefail
exit 0
`
		);
		writeExecutable(
			path.join(hooksDir, 'screenshot-guard.sh'),
			`#!/usr/bin/env bash
set -euo pipefail
touch "${marker.replace(/\\/g, '/')}"
exit 1
`
		);

		const result = await runPrePush(root, path.join(hooksDir, 'pre-push'), tagRefLine);

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(marker)).toBeFalse();
		expect(result.stdout).toContain('screenshot guard: not applicable');
		expect(result.stdout).toContain('pre-push: passed');
	});
});
