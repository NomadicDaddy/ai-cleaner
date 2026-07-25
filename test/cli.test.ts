import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface CliResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

interface TestTarget {
	enabled?: boolean;
	kind?: 'any' | 'directory' | 'file';
	name: string;
	paths: string[];
	retention?: {
		allowEmpty?: boolean;
		keepCount?: number;
		keepDays?: number;
	};
	risk?: 'aggressive' | 'normal';
	tool: string;
}

const repositoryRoot = path.resolve(import.meta.dir, '..');
const entrypoint = path.join(repositoryRoot, 'index.ts');
const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cleaner-test-'));
	temporaryRoots.push(root);
	return root;
};

const writeConfig = (root: string, targets: TestTarget[]): string => {
	const configPath = path.join(root, 'config.json');
	fs.writeFileSync(
		configPath,
		JSON.stringify({ defaultRetention: { keepCount: 5 }, targets }, null, 2)
	);
	return configPath;
};

const runCli = async (args: string[], cwd = repositoryRoot): Promise<CliResult> => {
	const processHandle = Bun.spawn([process.execPath, entrypoint, ...args], {
		cwd,
		stderr: 'pipe',
		stdout: 'pipe',
	});
	const [exitCode, stderr, stdout] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stderr).text(),
		new Response(processHandle.stdout).text(),
	]);
	return { exitCode, stderr, stdout };
};

const targetFor = (artifactRoot: string, overrides: Partial<TestTarget> = {}): TestTarget => ({
	kind: 'any',
	name: 'Test artifacts',
	paths: [artifactRoot],
	retention: { allowEmpty: true, keepCount: 0 },
	tool: 'test',
	...overrides,
});

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
});

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
			})
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
			JSON.stringify({ targets: [targetFor(root), targetFor(child, { name: 'Child' })] })
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
});

describe('CLI and packaged defaults', () => {
	test('rejects an option used as the --config value with exit code 2', async () => {
		const result = await runCli(['--config', '--dry-run']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain('--config requires a path argument');
	});

	test('loads the bundled config outside the repository directory', async () => {
		const root = createTemporaryRoot();
		const result = await runCli([], root);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('DRY RUN MODE ENABLED');
	});

	test('the bundled config covers every canonical agent home safely', () => {
		const config = JSON.parse(
			fs.readFileSync(path.join(repositoryRoot, 'config.json'), 'utf8')
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
			'gemini',
			'grok',
			'kilo',
			'kiro',
			'opencode',
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
