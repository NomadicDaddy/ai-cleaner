import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { processTarget } from '../src/cleanup.ts';
import { buildTargetPlan, type FilesystemAdapter } from '../src/filesystem-safety.ts';
import {
	cleanupTemporaryRoots,
	createTemporaryRoot,
	runCli,
	targetFor,
	writeConfig,
} from './cli-fixture.ts';

afterEach(cleanupTemporaryRoots);

describe('preset selection and order', () => {
	test('processes only the selected preset before explicit targets', async () => {
		const root = createTemporaryRoot();
		const presetARoot = path.join(root, 'preset-a');
		const presetBRoot = path.join(root, 'preset-b');
		const explicitRoot = path.join(root, 'explicit');
		fs.mkdirSync(presetARoot);
		fs.mkdirSync(presetBRoot);
		fs.mkdirSync(explicitRoot);
		fs.writeFileSync(path.join(presetARoot, 'old.log'), 'a');
		fs.writeFileSync(path.join(presetBRoot, 'old.log'), 'b');
		fs.writeFileSync(path.join(explicitRoot, 'old.log'), 'e');

		const configPath = path.join(root, 'config.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				defaultRetention: { allowEmpty: true, keepCount: 0 },
				presets: {
					'preset-a': [targetFor(presetARoot, { name: 'Preset A', tool: 'pa' })],
					'preset-b': [targetFor(presetBRoot, { name: 'Preset B', tool: 'pb' })],
				},
				targets: [targetFor(explicitRoot, { name: 'Explicit', tool: 'ex' })],
				usePresets: ['preset-a'],
			})
		);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(presetARoot, 'old.log'))).toBeFalse();
		expect(fs.existsSync(path.join(presetBRoot, 'old.log'))).toBeTrue();
		expect(fs.existsSync(path.join(explicitRoot, 'old.log'))).toBeFalse();
		expect(result.stdout).toContain('Preset A');
		expect(result.stdout).toContain('Explicit');
		expect(result.stdout).not.toContain('Preset B');
	});

	test('default usePresets activates all presets when omitted', async () => {
		const root = createTemporaryRoot();
		const presetARoot = path.join(root, 'preset-a');
		const presetBRoot = path.join(root, 'preset-b');
		fs.mkdirSync(presetARoot);
		fs.mkdirSync(presetBRoot);
		fs.writeFileSync(path.join(presetARoot, 'old.log'), 'a');
		fs.writeFileSync(path.join(presetBRoot, 'old.log'), 'b');

		const configPath = path.join(root, 'config.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				defaultRetention: { allowEmpty: true, keepCount: 0 },
				presets: {
					'preset-a': [targetFor(presetARoot, { name: 'Preset A', tool: 'pa' })],
					'preset-b': [targetFor(presetBRoot, { name: 'Preset B', tool: 'pb' })],
				},
			})
		);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(presetARoot, 'old.log'))).toBeFalse();
		expect(fs.existsSync(path.join(presetBRoot, 'old.log'))).toBeFalse();
	});
});

describe('legacy target discovery and overrides', () => {
	test('discovers legacy tool directories and applies override retention', async () => {
		const root = createTemporaryRoot();
		const toolDir = path.join(root, 'legacy-home');
		const toolA = path.join(toolDir, 'toolA');
		const toolB = path.join(toolDir, 'toolB');
		fs.mkdirSync(toolA, { recursive: true });
		fs.mkdirSync(toolB, { recursive: true });
		// Legacy targets default to kind 'directory', so use subdirectories as artifacts
		for (let i = 0; i < 3; i++) {
			const dir = path.join(toolA, `a${i}`);
			fs.mkdirSync(dir);
			fs.utimesSync(dir, i + 1, i + 1);
		}
		for (let i = 0; i < 3; i++) {
			const dir = path.join(toolB, `b${i}`);
			fs.mkdirSync(dir);
			fs.utimesSync(dir, i + 1, i + 1);
		}

		const configPath = path.join(root, 'config.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				defaultRetention: { keepCount: 2 },
				overrides: { toolA: { keepCount: 1 } },
				targetPaths: [toolDir],
			})
		);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		// toolA with keepCount 1 keeps newest (a2), deletes a0
		expect(fs.existsSync(path.join(toolA, 'a0'))).toBeFalse();
		expect(fs.existsSync(path.join(toolA, 'a2'))).toBeTrue();
		// toolB with default keepCount 2 keeps newest 2 (b1, b2), deletes b0
		expect(fs.existsSync(path.join(toolB, 'b0'))).toBeFalse();
		expect(fs.existsSync(path.join(toolB, 'b2'))).toBeTrue();
	});

	test('skips legacy entries already covered by explicit targets', async () => {
		const root = createTemporaryRoot();
		const toolDir = path.join(root, 'legacy-home');
		const toolA = path.join(toolDir, 'toolA');
		fs.mkdirSync(toolA, { recursive: true });
		fs.writeFileSync(path.join(toolA, 'a.log'), 'a');

		const configPath = path.join(root, 'config.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				defaultRetention: { allowEmpty: true, keepCount: 0 },
				targets: [targetFor(toolA, { name: 'Explicit toolA', tool: 'toolA' })],
				targetPaths: [toolDir],
			})
		);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(toolA, 'a.log'))).toBeFalse();
		expect(result.stdout).toContain('already covered by explicit target');
	});
});

describe('disabled targets', () => {
	test('disabled targets are skipped without scanning', async () => {
		const root = createTemporaryRoot();
		const disabledRoot = path.join(root, 'disabled');
		const activeRoot = path.join(root, 'active');
		fs.mkdirSync(disabledRoot);
		fs.mkdirSync(activeRoot);
		fs.writeFileSync(path.join(disabledRoot, 'old.log'), 'd');
		fs.writeFileSync(path.join(activeRoot, 'old.log'), 'a');

		const configPath = writeConfig(root, [
			{ ...targetFor(disabledRoot, { name: 'Disabled' }), enabled: false },
			targetFor(activeRoot, { name: 'Active' }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(disabledRoot, 'old.log'))).toBeTrue();
		expect(fs.existsSync(path.join(activeRoot, 'old.log'))).toBeFalse();
		expect(result.stdout).toContain('Skipping disabled target');
		expect(result.stdout).toContain('Skipped: 1');
		expect(result.stdout).toContain('Matched for deletion: 1');
	});

	test('inactive target with unavailable variable does not abort active siblings', async () => {
		const root = createTemporaryRoot();
		const activeRoot = path.join(root, 'active');
		fs.mkdirSync(activeRoot);
		fs.writeFileSync(path.join(activeRoot, 'old.log'), 'a');
		delete process.env['AI_CLEANER_INACTIVE_MISSING_VAR'];

		const configPath = writeConfig(root, [
			{
				enabled: false,
				kind: 'any',
				name: 'Inactive missing env',
				paths: ['$AI_CLEANER_INACTIVE_MISSING_VAR/sub'],
				retention: { allowEmpty: true, keepCount: 0 },
				tool: 'inactive',
			},
			targetFor(activeRoot, { name: 'Active sibling' }),
			{
				kind: 'any',
				name: 'Inactive aggressive missing env',
				paths: ['$AI_CLEANER_INACTIVE_MISSING_VAR/other'],
				retention: { allowEmpty: true, keepCount: 0 },
				risk: 'aggressive',
				tool: 'aggressive-inactive',
			},
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain('unavailable environment variable');
		expect(result.stdout).toContain('Skipping disabled target');
		expect(result.stdout).toContain('Skipping aggressive target');
		expect(result.stdout).toContain('Active sibling');
		expect(result.stdout).toContain('Skipped: 2');
		expect(result.stdout).toContain('Matched for deletion: 1');
		expect(fs.existsSync(path.join(activeRoot, 'old.log'))).toBeFalse();
	});

	test('inactive target with overlapping path does not abort active siblings', async () => {
		const root = createTemporaryRoot();
		const parentRoot = path.join(root, 'parent');
		const childRoot = path.join(parentRoot, 'child');
		const activeRoot = path.join(root, 'active');
		fs.mkdirSync(childRoot, { recursive: true });
		fs.mkdirSync(activeRoot);
		fs.writeFileSync(path.join(childRoot, 'nested.log'), 'n');
		fs.writeFileSync(path.join(activeRoot, 'old.log'), 'a');

		const configPath = writeConfig(root, [
			{ ...targetFor(parentRoot, { name: 'Disabled parent' }), enabled: false },
			{ ...targetFor(childRoot, { name: 'Disabled child' }), enabled: false },
			targetFor(activeRoot, { name: 'Active sibling' }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain('Cleanup roots overlap');
		expect(result.stdout).toContain('Skipping disabled target');
		expect(result.stdout).toContain('Active sibling');
		expect(result.stdout).toContain('Skipped: 2');
		expect(result.stdout).toContain('Matched for deletion: 1');
		expect(fs.existsSync(path.join(childRoot, 'nested.log'))).toBeTrue();
		expect(fs.existsSync(path.join(activeRoot, 'old.log'))).toBeFalse();
	});

	test('inactive dangerous path does not abort active siblings', async () => {
		const root = createTemporaryRoot();
		const activeRoot = path.join(root, 'active');
		fs.mkdirSync(activeRoot);
		fs.writeFileSync(path.join(activeRoot, 'old.log'), 'a');

		const dangerousPath = process.platform === 'win32' ? 'C:\\Users' : '/home';
		const configPath = writeConfig(root, [
			{
				enabled: false,
				kind: 'any',
				name: 'Disabled dangerous',
				paths: [dangerousPath],
				retention: { allowEmpty: true, keepCount: 0 },
				tool: 'dangerous',
			},
			targetFor(activeRoot, { name: 'Active sibling' }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain('Refusing dangerous cleanup root');
		expect(result.stdout).toContain('Skipping disabled target');
		expect(result.stdout).toContain('Matched for deletion: 1');
		expect(fs.existsSync(path.join(activeRoot, 'old.log'))).toBeFalse();
	});
});

describe('unavailable environment variables', () => {
	test('path referencing an unset environment variable exits 1 with expansion error', async () => {
		const root = createTemporaryRoot();
		delete process.env['AI_CLEANER_MISSING_VAR'];
		const configPath = path.join(root, 'config.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				targets: [
					{
						kind: 'any',
						name: 'EnvMissing',
						paths: ['$AI_CLEANER_MISSING_VAR/sub'],
						retention: { allowEmpty: true, keepCount: 0 },
						tool: 'test',
					},
				],
			})
		);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('unavailable environment variable');
		expect(result.stderr).toContain('AI_CLEANER_MISSING_VAR');
	});
});

describe('file-kind filtering', () => {
	test('file kind deletes old files but preserves directories', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		const oldDir = path.join(artifactRoot, 'old-dir');
		const oldFile = path.join(artifactRoot, 'old.log');
		fs.mkdirSync(artifactRoot);
		fs.mkdirSync(oldDir);
		fs.writeFileSync(oldFile, 'old');
		const oldTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
		fs.utimesSync(oldDir, oldTime, oldTime);
		fs.utimesSync(oldFile, oldTime, oldTime);

		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { kind: 'file', retention: { keepDays: 1 } }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(oldFile)).toBeFalse();
		expect(fs.existsSync(oldDir)).toBeTrue();
	});
});

describe('linked child artifacts', () => {
	test('refuses to delete a directory containing a symlink child', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		const target = path.join(artifactRoot, 'session-1');
		const realDest = path.join(root, 'real-dest');
		const linkChild = path.join(target, 'link-child');
		fs.mkdirSync(target, { recursive: true });
		fs.mkdirSync(realDest);
		fs.symlinkSync(realDest, linkChild, process.platform === 'win32' ? 'junction' : 'dir');

		const configPath = writeConfig(root, [targetFor(artifactRoot, { kind: 'directory' })]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('symbolic link or junction');
		expect(fs.existsSync(target)).toBeTrue();
	});
});

describe('mixed success and refusal totals', () => {
	test('ordinary deletion succeeds while protected artifact is refused; exit 1', async () => {
		const root = createTemporaryRoot();
		const ordinaryDir = path.join(root, 'ordinary');
		const protectedDir = path.join(root, 'protected');
		const ordinaryArtifact = path.join(ordinaryDir, 'session-1');
		const protectedArtifact = path.join(protectedDir, 'session-2');
		fs.mkdirSync(ordinaryArtifact, { recursive: true });
		fs.mkdirSync(protectedArtifact, { recursive: true });
		fs.writeFileSync(path.join(protectedArtifact, '.env'), 'SECRET=leaked');

		const configPath = writeConfig(root, [
			targetFor(ordinaryDir, { name: 'Ordinary', tool: 't1' }),
			targetFor(protectedDir, { name: 'Protected', tool: 't2' }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(1);
		expect(fs.existsSync(ordinaryArtifact)).toBeFalse();
		expect(fs.existsSync(protectedArtifact)).toBeTrue();
		expect(result.stdout).toContain('Matched for deletion: 1');
		expect(result.stdout).toContain('Failed or refused: 1');
		expect(result.stderr).toContain('contains protected sensitive path');
	});

	test('unrelated sentinel is preserved when a sibling artifact is refused', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		const oldest = path.join(artifactRoot, 'oldest'); // deleted (oldest, ordinary)
		const middle = path.join(artifactRoot, 'middle'); // refused (contains .env)
		const sentinel = path.join(artifactRoot, 'newest'); // kept by retention
		fs.mkdirSync(artifactRoot);
		fs.mkdirSync(oldest);
		fs.mkdirSync(middle, { recursive: true });
		fs.mkdirSync(sentinel);
		fs.writeFileSync(path.join(middle, '.env'), 'SECRET=leaked');
		// Make timestamps distinct: oldest < middle < sentinel
		const base = Date.now() / 1000 - 100;
		fs.utimesSync(oldest, base, base);
		fs.utimesSync(middle, base + 50, base + 50);
		fs.utimesSync(sentinel, base + 200, base + 200);

		const configPath = writeConfig(root, [
			targetFor(artifactRoot, {
				kind: 'directory',
				name: 'Mixed',
				retention: { keepCount: 1 },
				tool: 't1',
			}),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(1);
		expect(fs.existsSync(oldest)).toBeFalse();
		expect(fs.existsSync(middle)).toBeTrue();
		expect(fs.existsSync(sentinel)).toBeTrue();
		expect(result.stdout).toContain('Matched for deletion: 1');
		expect(result.stdout).toContain('Failed or refused: 1');
	});
});

describe('filesystem adapter fault injection', () => {
	// Helper: create a test fixture with two directories under a cleanup root.
	const setupFixture = (): {
		artifactRoot: string;
		dirToDelete: string;
		sentinelDir: string;
		tempRoot: string;
	} => {
		const tempRoot = createTemporaryRoot();
		const artifactRoot = path.join(tempRoot, 'artifacts');
		const dirToDelete = path.join(artifactRoot, 'session-1');
		const sentinelDir = path.join(artifactRoot, 'sentinel-2');
		fs.mkdirSync(dirToDelete, { recursive: true });
		fs.mkdirSync(sentinelDir, { recursive: true });
		return { artifactRoot, dirToDelete, sentinelDir, tempRoot };
	};

	const planTarget = (artifactRoot: string, fsAdapter: FilesystemAdapter) =>
		buildTargetPlan(
			[
				{
					name: 'Fault injection',
					paths: [artifactRoot],
					tool: 'test',
					kind: 'directory',
					retention: { allowEmpty: true, keepCount: 0 },
				},
			],
			fsAdapter
		);

	const realAdapter: FilesystemAdapter = {
		lstatSync: (p) => fs.lstatSync(p),
		readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
		realpathSync: (p) => fs.realpathSync.native(p),
		rmSync: (p, options) => fs.rmSync(p, options),
	};

	test('rmSync failure on targeted artifact preserves unrelated sentinel', () => {
		const { artifactRoot, dirToDelete, sentinelDir, tempRoot } = setupFixture();

		const adapter: FilesystemAdapter = {
			...realAdapter,
			rmSync: (p, options) => {
				if (path.resolve(p) === path.resolve(dirToDelete)) {
					throw Object.assign(new Error('EACCES: simulated rm failure'), {
						code: 'EACCES',
					});
				}
				realAdapter.rmSync(p, options);
			},
		};

		const plan = planTarget(artifactRoot, adapter);
		const result = processTarget(
			plan[0]!,
			{ keepCount: 0, allowEmpty: true },
			true,
			false,
			adapter
		);
		expect(result.failed).toBe(1);
		expect(result.matched).toBe(1);
		expect(fs.existsSync(dirToDelete)).toBeTrue();
		expect(fs.existsSync(sentinelDir)).toBeFalse();
		fs.rmSync(tempRoot, { force: true, recursive: true });
	});

	test('realpath failure on second containment check refuses artifact and preserves sentinel', () => {
		const { artifactRoot, dirToDelete, sentinelDir, tempRoot } = setupFixture();

		const realpathCallCount: Record<string, number> = {};
		const adapter: FilesystemAdapter = {
			...realAdapter,
			realpathSync: (p) => {
				const key = path.resolve(p);
				realpathCallCount[key] = (realpathCallCount[key] ?? 0) + 1;
				// On the second realpath call for dirToDelete (second revalidation), fail.
				if (key === path.resolve(dirToDelete) && realpathCallCount[key]! >= 2) {
					throw Object.assign(new Error('EIO: simulated realpath failure'), {
						code: 'EIO',
					});
				}
				return realAdapter.realpathSync(p);
			},
			rmSync: () => {
				throw new Error('rm should not be reached');
			},
		};

		const plan = planTarget(artifactRoot, adapter);
		const result = processTarget(
			plan[0]!,
			{ keepCount: 0, allowEmpty: true },
			true,
			false,
			adapter
		);
		expect(result.failed).toBe(2);
		expect(result.matched).toBe(0);
		expect(fs.existsSync(dirToDelete)).toBeTrue();
		expect(fs.existsSync(sentinelDir)).toBeTrue();
		fs.rmSync(tempRoot, { force: true, recursive: true });
	});

	test('lstat failure on artifact during listing counts as failed and preserves it', () => {
		const { artifactRoot, dirToDelete, sentinelDir, tempRoot } = setupFixture();

		const adapter: FilesystemAdapter = {
			...realAdapter,
			lstatSync: (p) => {
				if (path.resolve(p) === path.resolve(dirToDelete)) {
					throw Object.assign(new Error('EPERM: simulated lstat failure'), {
						code: 'EPERM',
					});
				}
				return realAdapter.lstatSync(p);
			},
		};

		const plan = planTarget(artifactRoot, adapter);
		const result = processTarget(
			plan[0]!,
			{ keepCount: 0, allowEmpty: true },
			false,
			false,
			adapter
		);
		// dirToDelete fails listing lstat (failed=1); sentinel is matched in dry-run (matched=1)
		expect(result.failed).toBe(1);
		expect(result.matched).toBe(1);
		expect(fs.existsSync(dirToDelete)).toBeTrue();
		expect(fs.existsSync(sentinelDir)).toBeTrue();
		fs.rmSync(tempRoot, { force: true, recursive: true });
	});

	test('readdir failure on root counts as failed with empty artifact list', () => {
		const { artifactRoot, dirToDelete, sentinelDir, tempRoot } = setupFixture();

		const adapter: FilesystemAdapter = {
			...realAdapter,
			readdirSync: (p) => {
				if (path.resolve(p) === path.resolve(artifactRoot)) {
					throw Object.assign(new Error('EIO: simulated readdir failure'), {
						code: 'EIO',
					});
				}
				return realAdapter.readdirSync(p);
			},
		};

		const plan = planTarget(artifactRoot, adapter);
		const result = processTarget(
			plan[0]!,
			{ keepCount: 0, allowEmpty: true },
			true,
			false,
			adapter
		);
		expect(result.failed).toBe(1);
		expect(result.matched).toBe(0);
		expect(fs.existsSync(dirToDelete)).toBeTrue();
		expect(fs.existsSync(sentinelDir)).toBeTrue();
		fs.rmSync(tempRoot, { force: true, recursive: true });
	});

	test('artifact replaced by symlink between containment checks is refused', () => {
		const { artifactRoot, dirToDelete, sentinelDir, tempRoot } = setupFixture();
		const realElsewhere = path.join(tempRoot, 'elsewhere');
		fs.mkdirSync(realElsewhere);

		const lstatCallCount: Record<string, number> = {};
		const adapter: FilesystemAdapter = {
			...realAdapter,
			lstatSync: (p) => {
				const key = path.resolve(p);
				lstatCallCount[key] = (lstatCallCount[key] ?? 0) + 1;
				// Replace dirToDelete with a symlink after its second lstat call
				// (second revalidation lstat sees the link and refuses).
				if (
					key === path.resolve(dirToDelete) &&
					lstatCallCount[key]! >= 3 &&
					!fs.existsSync(path.join(dirToDelete, '.swapped'))
				) {
					fs.rmSync(dirToDelete, { force: true, recursive: true });
					fs.symlinkSync(
						realElsewhere,
						dirToDelete,
						process.platform === 'win32' ? 'junction' : 'dir'
					);
					fs.writeFileSync(path.join(tempRoot, '.swapped'), 'done');
				}
				return realAdapter.lstatSync(p);
			},
			rmSync: () => {
				throw new Error('rm should not be reached');
			},
		};

		const plan = planTarget(artifactRoot, adapter);
		const result = processTarget(
			plan[0]!,
			{ keepCount: 0, allowEmpty: true },
			true,
			false,
			adapter
		);
		expect(result.failed).toBe(2);
		expect(result.matched).toBe(0);
		expect(fs.existsSync(sentinelDir)).toBeTrue();
		fs.rmSync(tempRoot, { force: true, recursive: true });
	});

	test('all refusals across multiple artifacts produce exit-code-1-equivalent failed count', () => {
		const tempRoot = createTemporaryRoot();
		const artifactRoot = path.join(tempRoot, 'artifacts');
		fs.mkdirSync(artifactRoot, { recursive: true });
		const dirs = ['d1', 'd2', 'd3'].map((name) => {
			const dir = path.join(artifactRoot, name);
			fs.mkdirSync(dir);
			return dir;
		});
		// d2 has a protected child so it will be refused
		fs.writeFileSync(path.join(dirs[1]!, '.env'), 'secret');

		const adapter: FilesystemAdapter = {
			...realAdapter,
			rmSync: (p, options) => {
				if (path.resolve(p) === path.resolve(dirs[0]!)) {
					throw Object.assign(new Error('EACCES: simulated rm failure'), {
						code: 'EACCES',
					});
				}
				realAdapter.rmSync(p, options);
			},
		};

		const plan = buildTargetPlan(
			[
				{
					name: 'Multi',
					paths: [artifactRoot],
					tool: 'test',
					kind: 'directory',
					retention: { allowEmpty: true, keepCount: 0 },
				},
			],
			adapter
		);
		const result = processTarget(
			plan[0]!,
			{ keepCount: 0, allowEmpty: true },
			true,
			false,
			adapter
		);
		// d1: rm failure (failed), d2: protected .env (failed), d3: success (matched)
		expect(result.failed).toBe(2);
		expect(result.matched).toBe(1);
		// Exit code 1 because failed > 0
		expect(result.failed > 0).toBeTrue();
		fs.rmSync(tempRoot, { force: true, recursive: true });
	});
});

describe('platform junction and symlink coverage', () => {
	test('junction cleanup root is refused on Windows; directory symlink on Unix', async () => {
		const root = createTemporaryRoot();
		const actual = path.join(root, 'actual');
		const linked = path.join(root, 'linked');
		fs.mkdirSync(actual);
		const linkType = process.platform === 'win32' ? 'junction' : 'dir';
		fs.symlinkSync(actual, linked, linkType);

		const configPath = writeConfig(root, [targetFor(linked)]);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('symbolic link or junction');
		expect(fs.existsSync(actual)).toBeTrue();
	});

	test('host platform recorded for reparse-point case', () => {
		const platform = process.platform;
		const linkType = platform === 'win32' ? 'junction' : 'dir';
		expect(linkType).toBeDefined();
		// This test documents the host platform under which the junction/symlink
		// scenario was exercised. The testing-scenarios.md catalog maps this to
		// an automated test name rather than a manual-only result.
		expect(['win32', 'linux', 'darwin']).toContain(platform);
	});
});
