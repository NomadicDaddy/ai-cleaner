import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
	captureDeclaredFixture,
	commitFixtureFiles,
	tagRefLineFor,
	writeCaptureEvidence,
} from './capture-fixture.ts';
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

// The synthetic SHA above is right for the temporary fixtures: they hold no commits, so no revision
// would resolve in them anyway, and having no push remote the history guard exits before it reads
// one. A run against THIS repository is the opposite case — the guard does resolve the revision, and
// an unresolvable one is precisely what it refuses to read as "no .aidd commits" (it fails closed;
// see aidd-history-guard.sh). Handing it a synthetic SHA there asserts a contradiction: the test
// demands exit 0 from a guard whose contract is to block. Name a real revision instead.
//
// This only became reachable when the repository gained a push remote. Before that the guard
// short-circuited on every call and the assertion passed without exercising anything.
const realTagRefLine = (): string => {
	const git = process.platform === 'win32' ? 'git.exe' : 'git';
	const head = Bun.spawnSync([git, 'rev-parse', 'HEAD'], { cwd: repositoryRoot })
		.stdout.toString()
		.trim();
	return `refs/tags/v1.2.0 ${head} refs/tags/v1.2.0 0000000000000000000000000000000000000000`;
};

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

const writeExecutable = (filePath: string, contents: string): void => {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents.replace(/\r\n/g, '\n'), { mode: 0o755 });
};

const installRealHooks = (hooksDir: string): void => {
	for (const name of ['pre-push', 'aidd-history-guard.sh', 'screenshot-guard.sh'] as const) {
		writeExecutable(
			path.join(hooksDir, name),
			fs.readFileSync(path.join(repositoryRoot, '.githooks', name), 'utf8')
		);
	}
};

const writePngs = (dir: string, count: number): void => {
	fs.mkdirSync(dir, { recursive: true });
	for (let i = 0; i < count; i += 1) {
		fs.writeFileSync(path.join(dir, `page-${i}.png`), 'png');
	}
};

// The history guard needs a real repository: without one its `git remote -v` probe fails
// (caught by 2>/dev/null) and it would exit 0 for reasons unrelated to this repo's shape.
const initFixtureRepository = (root: string): void => {
	const git = process.platform === 'win32' ? 'git.exe' : 'git';
	Bun.spawnSync([git, 'init', '--quiet'], { cwd: root });
	Bun.spawnSync([git, 'config', 'user.email', 'fixture@example.invalid'], { cwd: root });
	Bun.spawnSync([git, 'config', 'user.name', 'Fixture'], { cwd: root });
};

describe('pre-push screenshot guard wiring', () => {
	test('unconditionally invokes the shared screenshot guard in this repository', async () => {
		// The package-capability gate is gone: pre-push invokes screenshot-guard.sh for every
		// push, and applicability is decided by the guard's own root-based contract file.
		const prePushSource = fs.readFileSync(
			path.join(repositoryRoot, '.githooks', 'pre-push'),
			'utf8'
		);
		expect(prePushSource).not.toContain('smoke:screenshots');
		expect(prePushSource).toContain('screenshot-guard.sh');

		// This repository has no capture declaration, so a version-tag push must pass without a
		// bypass flag while the guard still runs and reports nothing to enforce.
		expect(fs.existsSync(path.join(repositoryRoot, '.screenshot-capture'))).toBeFalse();

		const result = await runPrePush(
			repositoryRoot,
			path.join(repositoryRoot, '.githooks', 'pre-push'),
			realTagRefLine()
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('pre-push: aidd history guard');
		expect(result.stdout).toContain('pre-push: screenshot guard');
		expect(result.stdout).not.toContain('not applicable');
		expect(result.stdout).toContain('pre-push: passed');
		expect(result.stderr).not.toContain('PUSH BLOCKED');
	});

	test('passes a version-tag push when the tagged tree has no capture declaration', async () => {
		const root = createTemporaryRoot();
		initFixtureRepository(root);
		const identity = commitFixtureFiles(root, { 'fixture.txt': 'fixture\n' });
		installRealHooks(path.join(root, '.githooks'));

		const result = await runPrePush(
			root,
			path.join(root, '.githooks', 'pre-push'),
			tagRefLineFor(identity.commit)
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain(
			'tagged tree has no .screenshot-capture; capture is not required'
		);
		expect(result.stdout).toContain('pre-push: screenshot guard');
		expect(result.stdout).toContain('pre-push: passed');
	});

	test('fails an opted-in tag when the release evidence directory is missing', async () => {
		const root = createTemporaryRoot();
		initFixtureRepository(root);
		const identity = captureDeclaredFixture(root);
		installRealHooks(path.join(root, '.githooks'));

		const result = await runPrePush(
			root,
			path.join(root, '.githooks', 'pre-push'),
			tagRefLineFor(identity.commit)
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("lstat 'screenshots'");
		expect(result.stderr).toContain('PUSH BLOCKED');
	});

	test('fails an opted-in tag when the run manifest is missing', async () => {
		const root = createTemporaryRoot();
		initFixtureRepository(root);
		const identity = captureDeclaredFixture(root);
		installRealHooks(path.join(root, '.githooks'));
		writePngs(path.join(root, 'screenshots', 'v1.2.0'), 6);

		const result = await runPrePush(
			root,
			path.join(root, '.githooks', 'pre-push'),
			tagRefLineFor(identity.commit)
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('release-run.json');
		expect(result.stderr).toContain('PUSH BLOCKED');
	});

	test('passes an opted-in tag whose release evidence is complete', async () => {
		const root = createTemporaryRoot();
		initFixtureRepository(root);
		const identity = captureDeclaredFixture(root);
		installRealHooks(path.join(root, '.githooks'));
		writeCaptureEvidence(root, identity);

		const result = await runPrePush(
			root,
			path.join(root, '.githooks', 'pre-push'),
			tagRefLineFor(identity.commit)
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain('verified full release capture');
		expect(result.stderr).not.toContain('PUSH BLOCKED');
		expect(result.stdout).toContain('pre-push: passed');
	});

	test('a failing AIDD history guard short-circuits before the screenshot guard runs', async () => {
		const root = createTemporaryRoot();
		const hooksDir = path.join(root, '.githooks');
		const marker = path.join(root, 'screenshot-guard-ran');
		const historyMarker = path.join(root, 'history-guard-ran');

		// Real wrapper so the wiring under test is the production script.
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
		// History guard failed closed before the screenshot stage; it must not claim success.
		expect(result.stdout).not.toContain('pre-push: screenshot guard');
		expect(result.stdout).not.toContain('pre-push: passed');
	});

	test('a failing screenshot guard propagates through pre-push and blocks the push', async () => {
		const root = createTemporaryRoot();
		const hooksDir = path.join(root, '.githooks');
		const marker = path.join(root, 'screenshot-guard-ran');

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
echo "PUSH BLOCKED: stub refusal" >&2
exit 7
`
		);

		const result = await runPrePush(root, path.join(hooksDir, 'pre-push'), tagRefLine);

		expect(result.exitCode).toBe(7);
		expect(fs.existsSync(marker)).toBeTrue();
		expect(result.stderr).toContain('PUSH BLOCKED: stub refusal');
		expect(result.stdout).toContain('pre-push: screenshot guard');
		// The failure must propagate: the wrapper never prints its success line.
		expect(result.stdout).not.toContain('pre-push: passed');
	});
});
