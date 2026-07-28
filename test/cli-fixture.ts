import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CliResult {
	exitCode: number;
	stderr: string;
	stdout: string;
}

export interface TestTarget {
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

export const repositoryRoot = path.resolve(import.meta.dir, '..');
const entrypoint = path.join(repositoryRoot, 'index.ts');

const temporaryRoots: string[] = [];

export const createTemporaryRoot = (): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cleaner-test-'));
	temporaryRoots.push(root);
	return root;
};

export const writeConfig = (root: string, targets: TestTarget[]): string => {
	const configPath = path.join(root, 'config.json');
	fs.writeFileSync(
		configPath,
		JSON.stringify({ defaultRetention: { keepCount: 5 }, targets }, null, 2)
	);
	return configPath;
};

export const runCli = async (args: string[], cwd = repositoryRoot): Promise<CliResult> => {
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

export const targetFor = (
	artifactRoot: string,
	overrides: Partial<TestTarget> = {}
): TestTarget => ({
	kind: 'any',
	name: 'Test artifacts',
	paths: [artifactRoot],
	retention: { allowEmpty: true, keepCount: 0 },
	tool: 'test',
	...overrides,
});

export const cleanupTemporaryRoots = (): void => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
};
