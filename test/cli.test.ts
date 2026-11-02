import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	cleanupTemporaryRoots,
	createTemporaryRoot,
	type TestTarget,
	repositoryRoot,
	runCli,
	targetFor,
	writeConfig,
	writePresetsConfig,
} from './cli-fixture.ts';

afterEach(cleanupTemporaryRoots);

describe('cleanup execution', () => {
	test('defaults to dry-run and requires --apply before deleting', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const artifact = path.join(artifactRoot, 'old.log');
		fs.writeFileSync(artifact, 'old');
		const configPath = writeConfig(root, [targetFor(artifactRoot)]);

		const preview = await runCli(['--config', configPath]);
		expect(preview.exitCode).toBe(0);
		expect(preview.stdout).toContain('[DRY RUN] Would delete:');
		expect(fs.existsSync(artifact)).toBeTrue();

		const applied = await runCli(['--config', configPath, '--apply']);
		expect(applied.exitCode).toBe(0);
		expect(fs.existsSync(artifact)).toBeFalse();
	});

	test('keeps the newest artifacts for keepCount', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const artifacts = ['old', 'middle', 'new'].map((name, index) => {
			const artifact = path.join(artifactRoot, `${name}.log`);
			fs.writeFileSync(artifact, name);
			fs.utimesSync(artifact, index + 1, index + 1);
			return artifact;
		});
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { keepCount: 2 } }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(artifacts[0]!)).toBeFalse();
		expect(fs.existsSync(artifacts[1]!)).toBeTrue();
		expect(fs.existsSync(artifacts[2]!)).toBeTrue();
	});

	test('deletes only artifacts older than keepDays', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const oldArtifact = path.join(artifactRoot, 'old.log');
		const newArtifact = path.join(artifactRoot, 'new.log');
		fs.writeFileSync(oldArtifact, 'old');
		fs.writeFileSync(newArtifact, 'new');
		const oldTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
		fs.utimesSync(oldArtifact, oldTime, oldTime);
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { keepDays: 1 } }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(oldArtifact)).toBeFalse();
		expect(fs.existsSync(newArtifact)).toBeTrue();
	});

	test('requires explicit confirmation for applied aggressive cleanup', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const artifact = path.join(artifactRoot, 'old.log');
		fs.writeFileSync(artifact, 'old');
		const configPath = writeConfig(root, [targetFor(artifactRoot, { risk: 'aggressive' })]);

		const refused = await runCli(['--config', configPath, '--apply', '--aggressive']);
		expect(refused.exitCode).toBe(2);
		expect(fs.existsSync(artifact)).toBeTrue();

		const confirmed = await runCli([
			'--config',
			configPath,
			'--apply',
			'--aggressive',
			'--confirm-aggressive',
		]);
		expect(confirmed.exitCode).toBe(0);
		expect(fs.existsSync(artifact)).toBeFalse();
	});
});

describe('agent selection', () => {
	const createPresetFixture = (
		root: string,
		presetName: string,
	): { artifact: string; artifactRoot: string } => {
		const artifactRoot = path.join(root, presetName);
		fs.mkdirSync(artifactRoot);
		const artifact = path.join(artifactRoot, 'session.log');
		fs.writeFileSync(artifact, 'payload');
		return { artifact, artifactRoot };
	};

	const presetConfigFor = (
		root: string,
		presets: Record<string, string[]>,
		fields: { usePresets?: string[] } = {},
	): string => {
		const configured: Record<string, TestTarget[]> = {};
		for (const [presetName, artifactRoots] of Object.entries(presets)) {
			configured[presetName] = artifactRoots.map((artifactRoot) =>
				targetFor(artifactRoot, { tool: presetName }),
			);
		}
		return writePresetsConfig(root, configured, fields);
	};

	test('runs only the selected preset without a custom configuration file', async () => {
		const result = await runCli(['--agent', 'claude-code'], repositoryRoot);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Agent selection: claude-code');
		expect(result.stdout).toContain('Analyzing claude-code');
		expect(result.stdout).not.toContain('Analyzing cursor');
		expect(result.stdout).toContain('DRY RUN MODE ENABLED');
	});

	test('runs only the selected preset among several', async () => {
		const root = createTemporaryRoot();
		const alpha = createPresetFixture(root, 'alpha');
		const beta = createPresetFixture(root, 'beta');
		const configPath = presetConfigFor(root, {
			alpha: [alpha.artifactRoot],
			beta: [beta.artifactRoot],
		});

		const result = await runCli(['--config', configPath, '--apply', '--agent', 'alpha']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(alpha.artifact)).toBeFalse();
		expect(fs.existsSync(beta.artifact)).toBeTrue();
	});

	test('processes every repeated selection', async () => {
		const root = createTemporaryRoot();
		const alpha = createPresetFixture(root, 'alpha');
		const beta = createPresetFixture(root, 'beta');
		const configPath = presetConfigFor(root, {
			alpha: [alpha.artifactRoot],
			beta: [beta.artifactRoot],
		});

		const result = await runCli([
			'--config',
			configPath,
			'--apply',
			'--agent',
			'alpha',
			'--agent',
			'beta',
		]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Agent selection: alpha, beta');
		expect(fs.existsSync(alpha.artifact)).toBeFalse();
		expect(fs.existsSync(beta.artifact)).toBeFalse();
	});

	test('selecting an empty preset reports no targets rather than failing', async () => {
		const root = createTemporaryRoot();
		const configPath = writePresetsConfig(root, { 'checked-home': [] });

		const result = await runCli(['--config', configPath, '--agent', 'checked-home']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Agent selection: checked-home');
		expect(result.stdout).toContain('No cleanup targets configured.');
	});

	test('intersects the selection with config-level usePresets', async () => {
		const root = createTemporaryRoot();
		const alpha = createPresetFixture(root, 'alpha');
		const beta = createPresetFixture(root, 'beta');
		const configPath = presetConfigFor(
			root,
			{ alpha: [alpha.artifactRoot], beta: [beta.artifactRoot] },
			{ usePresets: ['alpha', 'beta'] },
		);

		const result = await runCli(['--config', configPath, '--apply', '--agent', 'beta']);
		expect(result.exitCode).toBe(0);
		// beta is both selected and active; alpha is active but not selected.
		expect(fs.existsSync(alpha.artifact)).toBeTrue();
		expect(fs.existsSync(beta.artifact)).toBeFalse();
	});

	test('an empty intersection processes no targets and reports that state', async () => {
		const root = createTemporaryRoot();
		const alpha = createPresetFixture(root, 'alpha');
		const beta = createPresetFixture(root, 'beta');
		const configPath = presetConfigFor(
			root,
			{ alpha: [alpha.artifactRoot], beta: [beta.artifactRoot] },
			{ usePresets: ['alpha'] },
		);

		const result = await runCli(['--config', configPath, '--agent', 'beta']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			'The --agent selection matches no active presets; no targets to process.',
		);
		expect(result.stdout).not.toContain('Would delete');
		expect(fs.existsSync(alpha.artifact)).toBeTrue();
		expect(fs.existsSync(beta.artifact)).toBeTrue();
	});

	test('a preset selection skips explicit targets and legacy targetPaths', async () => {
		const root = createTemporaryRoot();
		const alpha = createPresetFixture(root, 'alpha');
		const explicitRoot = path.join(root, 'explicit');
		fs.mkdirSync(explicitRoot);
		const explicitArtifact = path.join(explicitRoot, 'session.log');
		fs.writeFileSync(explicitArtifact, 'payload');
		const configPath = path.join(root, 'mixed.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				presets: { alpha: [targetFor(alpha.artifactRoot, { tool: 'alpha' })] },
				targets: [targetFor(explicitRoot, { name: 'Explicit target' })],
			}),
		);

		const result = await runCli(['--config', configPath, '--apply', '--agent', 'alpha']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(alpha.artifact)).toBeFalse();
		expect(fs.existsSync(explicitArtifact)).toBeTrue();
	});
});

describe('older-than filter', () => {
	const ageArtifact = (artifactRoot: string, name: string, ageDays: number): string => {
		const artifact = path.join(artifactRoot, name);
		fs.writeFileSync(artifact, name);
		const time = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
		fs.utimesSync(artifact, time, time);
		return artifact;
	};

	test('narrows a keepCount selection without widening it', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const ancient = ageArtifact(artifactRoot, 'ancient.log', 10);
		const recent = ageArtifact(artifactRoot, 'recent.log', 0);
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { allowEmpty: true, keepCount: 0 } }),
		]);

		const preview = await runCli(['--config', configPath, '--older-than', '5d']);
		expect(preview.exitCode).toBe(0);
		expect(preview.stdout).toContain('Age filter: only artifacts older than 5 days');
		expect(preview.stdout).toContain('[DRY RUN] Would delete:');
		// Console output escapes path separators, so assert on file names.
		expect(preview.stdout).toContain('ancient.log');
		expect(preview.stdout).not.toContain('recent.log');
		expect(fs.existsSync(ancient)).toBeTrue();
		expect(fs.existsSync(recent)).toBeTrue();

		const applied = await runCli(['--config', configPath, '--apply', '--older-than', '5d']);
		expect(applied.exitCode).toBe(0);
		expect(fs.existsSync(ancient)).toBeFalse();
		expect(fs.existsSync(recent)).toBeTrue();
	});

	test('keeps the full retention selection when the flag is omitted', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const ancient = ageArtifact(artifactRoot, 'ancient.log', 10);
		const recent = ageArtifact(artifactRoot, 'recent.log', 0);
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { allowEmpty: true, keepCount: 0 } }),
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(ancient)).toBeFalse();
		expect(fs.existsSync(recent)).toBeFalse();
	});

	test('narrows a keepDays selection to artifacts past the age threshold', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const sevenDay = ageArtifact(artifactRoot, 'seven-day.log', 7);
		const threeDay = ageArtifact(artifactRoot, 'three-day.log', 3);
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { keepDays: 1 } }),
		]);

		// keepDays: 1 alone selects both artifacts; the age filter must keep
		// three-day.log, proving the flag only narrows the retention selection.
		const result = await runCli(['--config', configPath, '--apply', '--older-than', '5d']);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(sevenDay)).toBeFalse();
		expect(fs.existsSync(threeDay)).toBeTrue();
	});
});

describe('configuration validation', () => {
	test('rejects malformed safety controls and empty paths', async () => {
		const root = createTemporaryRoot();
		const configPath = path.join(root, 'invalid.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				targets: [
					{
						enabled: 'false',
						kind: 'invalid',
						name: 'Invalid',
						paths: [''],
						risk: 'agressive',
						tool: 'test',
					},
				],
			}),
		);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('.kind must be directory, file, or any');
	});

	test('rejects non-object JSON and unknown fields', async () => {
		const root = createTemporaryRoot();
		const nullConfig = path.join(root, 'null.json');
		const unknownConfig = path.join(root, 'unknown.json');
		fs.writeFileSync(nullConfig, 'null');
		fs.writeFileSync(unknownConfig, JSON.stringify({ surprise: true }));

		const nullResult = await runCli(['--config', nullConfig]);
		const unknownResult = await runCli(['--config', unknownConfig]);
		expect(nullResult.exitCode).toBe(1);
		expect(nullResult.stderr).toContain('config must be an object');
		expect(unknownResult.exitCode).toBe(1);
		expect(unknownResult.stderr).toContain('unknown field: surprise');
	});

	test('rejects keepCount zero without allowEmpty', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { keepCount: 0 } }),
		]);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('Set allowEmpty: true');
	});

	test('rejects keepDays zero without allowEmpty', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { keepDays: 0 } }),
		]);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('keepDays is 0');
		expect(result.stderr).toContain('Set allowEmpty: true');
	});

	test('accepts keepDays zero with allowEmpty and defaults to dry-run', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const artifact = path.join(artifactRoot, 'session.log');
		fs.writeFileSync(artifact, 'payload');
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { allowEmpty: true, keepDays: 0 } }),
		]);

		const preview = await runCli(['--config', configPath]);
		expect(preview.exitCode).toBe(0);
		expect(preview.stdout).toContain('[DRY RUN] Would delete:');
		expect(fs.existsSync(artifact)).toBeTrue();

		const applied = await runCli(['--config', configPath, '--apply']);
		expect(applied.exitCode).toBe(0);
		expect(fs.existsSync(artifact)).toBeFalse();
	});
});

describe('path safety', () => {
	test('protects sensitive descendants from recursive deletion', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		const artifact = path.join(artifactRoot, 'session-1');
		fs.mkdirSync(artifact, { recursive: true });
		fs.writeFileSync(path.join(artifact, '.env'), 'SECRET=test');
		const configPath = writeConfig(root, [targetFor(artifactRoot, { kind: 'directory' })]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('contains protected sensitive path');
		expect(fs.existsSync(artifact)).toBeTrue();
	});

	test('rejects filesystem roots and overlapping targets', async () => {
		const root = createTemporaryRoot();
		const child = path.join(root, 'child');
		fs.mkdirSync(child);
		const filesystemRootConfig = writeConfig(root, [targetFor(path.parse(root).root)]);
		const rootResult = await runCli(['--config', filesystemRootConfig]);
		expect(rootResult.exitCode).toBe(1);
		expect(rootResult.stderr).toContain('dangerous cleanup root');

		const overlapConfig = path.join(root, 'overlap.json');
		fs.writeFileSync(
			overlapConfig,
			JSON.stringify({ targets: [targetFor(root), targetFor(child, { name: 'Child' })] }),
		);
		const overlapResult = await runCli(['--config', overlapConfig]);
		expect(overlapResult.exitCode).toBe(1);
		expect(overlapResult.stderr).toContain('Cleanup roots overlap');
	});

	test('rejects a junction cleanup root', async () => {
		const root = createTemporaryRoot();
		const actual = path.join(root, 'actual');
		const linked = path.join(root, 'linked');
		fs.mkdirSync(actual);
		fs.symlinkSync(actual, linked, process.platform === 'win32' ? 'junction' : 'dir');
		const configPath = writeConfig(root, [targetFor(linked)]);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('symbolic link or junction');
	});

	test('rejects protected system-tree descendants and exact-only containers', async () => {
		const root = createTemporaryRoot();
		const protectedDescendant =
			process.platform === 'win32'
				? 'C:\\Windows\\Temp'
				: '/usr/local/share/ai-cleaner-probe';
		const exactOnlyContainer = process.platform === 'win32' ? 'C:\\Users' : '/home';

		const descendantConfig = writeConfig(root, [targetFor(protectedDescendant)]);
		const descendantResult = await runCli(['--config', descendantConfig]);
		expect(descendantResult.exitCode).toBe(1);
		expect(descendantResult.stderr).toContain('dangerous cleanup root');

		const containerConfig = writeConfig(root, [
			targetFor(exactOnlyContainer, { name: 'Exact container' }),
		]);
		const containerResult = await runCli(['--config', containerConfig]);
		expect(containerResult.exitCode).toBe(1);
		expect(containerResult.stderr).toContain('dangerous cleanup root');
	});

	test('rejects regular-file cleanup roots while missing roots stay no-ops', async () => {
		const root = createTemporaryRoot();
		const fileRoot = path.join(root, 'not-a-directory.txt');
		const missingRoot = path.join(root, 'missing-root');
		fs.writeFileSync(fileRoot, 'not a directory');

		const fileConfig = writeConfig(root, [targetFor(fileRoot)]);
		const fileResult = await runCli(['--config', fileConfig, '--apply']);
		expect(fileResult.exitCode).toBe(1);
		expect(fileResult.stderr).toContain('is not a directory');
		expect(fs.existsSync(fileRoot)).toBeTrue();

		const missingConfig = writeConfig(root, [targetFor(missingRoot, { name: 'Missing' })]);
		const missingResult = await runCli(['--config', missingConfig, '--apply']);
		expect(missingResult.exitCode).toBe(0);
		expect(missingResult.stdout).toContain('No matching artifacts under');
	});
});

describe('CLI and packaged defaults', () => {
	const createSentinelFixture = (): {
		configPath: string;
		sentinel: string;
		sentinelPayload: string;
	} => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const sentinel = path.join(artifactRoot, 'sentinel.log');
		const sentinelPayload = 'do-not-touch';
		fs.writeFileSync(sentinel, sentinelPayload);
		const configPath = writeConfig(root, [
			targetFor(artifactRoot, { retention: { allowEmpty: true, keepCount: 0 } }),
		]);
		return { configPath, sentinel, sentinelPayload };
	};

	const expectSentinelUnchanged = (sentinel: string, payload: string): void => {
		expect(fs.existsSync(sentinel)).toBeTrue();
		expect(fs.readFileSync(sentinel, 'utf8')).toBe(payload);
	};

	const helpCases = [
		{ flag: '--help', label: '--help' },
		{ flag: '-h', label: '-h' },
	] as const;

	for (const { flag, label } of helpCases) {
		test(`prints help for ${label} without processing targets`, async () => {
			const { configPath, sentinel, sentinelPayload } = createSentinelFixture();

			const result = await runCli([flag, '--config', configPath, '--apply']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('--config <path>');
			expect(result.stdout).toContain('--agent <name>');
			expect(result.stdout).toContain('--dry-run');
			expect(result.stdout).toContain('--apply');
			expect(result.stdout).toContain('--older-than <age>');
			expect(result.stdout).toContain('--help, -h');
			expect(result.stdout).not.toContain('Starting AI Cleaner');
			expect(result.stdout).not.toContain('DRY RUN MODE ENABLED');
			expect(result.stdout).not.toContain('Cleanup complete');
			expect(result.stdout).not.toContain('[DRY RUN]');
			expectSentinelUnchanged(sentinel, sentinelPayload);
		});
	}

	const argumentErrorCases: {
		args: (configPath: string) => string[];
		errorMarker: string;
		name: string;
	}[] = [
		{
			args: (configPath) => ['--config', configPath, '--not-a-real-flag'],
			errorMarker: 'Unknown argument: --not-a-real-flag',
			name: 'rejects an unknown option with exit code 2',
		},
		{
			args: () => ['--config'],
			errorMarker: '--config requires a path argument',
			name: 'rejects a terminal --config without a path with exit code 2',
		},
		{
			args: () => ['--config', '--dry-run'],
			errorMarker: '--config requires a path argument',
			name: 'rejects an option used as the --config value with exit code 2',
		},
		{
			args: (configPath) => ['--config', configPath, '--dry-run', '--apply'],
			errorMarker: '--dry-run and --apply cannot be used together',
			name: 'rejects --dry-run combined with --apply with exit code 2',
		},
		{
			args: (configPath) => ['--config', configPath, '--older-than'],
			errorMarker: '--older-than requires an age argument',
			name: 'rejects a terminal --older-than without an age with exit code 2',
		},
		{
			args: (configPath) => ['--config', configPath, '--older-than', '30'],
			errorMarker: '--older-than requires a positive age in days',
			name: 'rejects an --older-than value without the d suffix with exit code 2',
		},
		{
			args: (configPath) => ['--config', configPath, '--older-than', '0d'],
			errorMarker: '--older-than requires a positive age in days',
			name: 'rejects a non-positive --older-than value with exit code 2',
		},
		{
			args: (configPath) => ['--config', configPath, '--agent'],
			errorMarker: '--agent requires a preset name argument',
			name: 'rejects a terminal --agent without a name with exit code 2',
		},
		{
			args: (configPath) => ['--config', configPath, '--agent', 'nope'],
			errorMarker: '--agent references unknown preset: nope',
			name: 'rejects an unknown --agent selection with exit code 2',
		},
	];

	for (const errorCase of argumentErrorCases) {
		test(errorCase.name, async () => {
			const { configPath, sentinel, sentinelPayload } = createSentinelFixture();

			const result = await runCli(errorCase.args(configPath));
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain(errorCase.errorMarker);
			expect(result.stderr).toContain('--help, -h');
			expect(result.stdout).not.toContain('Starting AI Cleaner');
			expect(result.stdout).not.toContain('DRY RUN MODE ENABLED');
			expect(result.stdout).not.toContain('Cleanup complete');
			expect(result.stdout).not.toContain('[DRY RUN]');
			expectSentinelUnchanged(sentinel, sentinelPayload);
		});
	}

	test('loads the bundled config outside the repository directory', async () => {
		const root = createTemporaryRoot();
		const result = await runCli([], root);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('DRY RUN MODE ENABLED');
	});

	test('the bundled config covers every canonical agent home safely', () => {
		const config = JSON.parse(
			fs.readFileSync(path.join(repositoryRoot, 'config.json'), 'utf8'),
		) as {
			presets: Record<string, TestTarget[]>;
		};
		const requiredPresets = [
			'agents',
			'antigravity',
			'claude-code',
			'cline',
			'codex',
			'copilot',
			'cursor',
			'devin',
			'gemini',
			'grok',
			'kilo',
			'kiro',
			'opencode',
			't3code',
			'windsurf',
			'zcode',
		];
		for (const preset of requiredPresets) {
			expect(config.presets).toHaveProperty(preset);
		}
		for (const target of Object.values(config.presets).flat()) {
			for (const configuredPath of target.paths) {
				expect(configuredPath).not.toMatch(/[\\/](agents|skills)(?:[\\/]|$)/i);
			}
		}
	});
});
