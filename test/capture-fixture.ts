import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const captureContract = {
	routes: ['/', '/a', '/b', '/c', '/d'],
	schema: 1,
	viewport: { height: 1309, width: 2250 },
};

const captureContractJson = JSON.stringify(captureContract);

const fixtureGit = (): string => (process.platform === 'win32' ? 'git.exe' : 'git');

const runGit = (root: string, args: string[]): string =>
	Bun.spawnSync([fixtureGit(), ...args], { cwd: root })
		.stdout.toString()
		.trim();

// Minimal PNG that satisfies the guard's structural checks: signature, IHDR chunk carrying the
// contract viewport, and the IEND trailer. Chunk CRCs are not part of the guard's contract.
const syntheticPng = (): Buffer => {
	const png = Buffer.alloc(45);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	png.writeUInt32BE(13, 8);
	png.write('IHDR', 12);
	png.writeUInt32BE(2250, 16);
	png.writeUInt32BE(1309, 20);
	png.set([8, 6, 0, 0, 0], 24);
	png.write('IEND', 37);
	png.set([0xae, 0x42, 0x60, 0x82], 41);
	return png;
};

export const commitFixtureFiles = (
	root: string,
	files: Record<string, string>,
): { commit: string; tree: string } => {
	for (const [relativePath, contents] of Object.entries(files)) {
		const target = path.join(root, relativePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, contents);
	}
	const names = Object.keys(files);
	runGit(root, ['add', '--', ...names]);
	runGit(root, ['commit', '--quiet', '-m', 'fixture']);
	return {
		commit: runGit(root, ['rev-parse', 'HEAD']),
		tree: runGit(root, ['rev-parse', 'HEAD^{tree}']),
	};
};

export const captureDeclaredFixture = (root: string): { commit: string; tree: string } =>
	commitFixtureFiles(root, {
		'.screenshot-capture': captureContractJson,
		'package.json': JSON.stringify({ version: '1.2.0' }),
	});

export const writeCaptureEvidence = (
	root: string,
	identity: { commit: string; tree: string },
): void => {
	const run = '01234567-89ab-cdef-0123-456789abcdef';
	const routes = captureContract.routes;
	const images = routes.map((route, index) => ({
		file: `page-${index}.png`,
		route,
		sha256: createHash('sha256').update(syntheticPng()).digest('hex'),
	}));
	const runDir = path.join(root, 'screenshots', 'v1.2.0', 'runs', run);
	fs.mkdirSync(runDir, { recursive: true });
	for (const image of images) {
		fs.writeFileSync(path.join(runDir, image.file), syntheticPng());
	}
	const report = {
		summary: { screenshotsTaken: images.length, success: true },
		visitedUrls: routes.map((route) => `http://localhost${route}`),
	};
	const reportBytes = Buffer.from(JSON.stringify(report));
	const digest = createHash('sha256').update(reportBytes).digest('hex');
	fs.writeFileSync(path.join(runDir, 'report.json'), reportBytes);
	const manifest = {
		analyzer: { failures: [], reportSha256: digest, success: true },
		build: {
			assets: [{ sha256: 'a'.repeat(64) }],
			mode: 'production',
			source: { clean: true, commit: identity.commit, tree: identity.tree },
			version: '1.2.0',
		},
		candidate: { clean: true, commit: identity.commit, tree: identity.tree },
		contract: JSON.parse(captureContractJson) as typeof captureContract,
		images,
		reportSha256: digest,
		routes,
		run,
		scope: {
			check404: true,
			page: null,
			startFrom: null,
			viewport: captureContract.viewport,
		},
		schema: 1,
		status: 'passed',
		success: true,
		version: '1.2.0',
	};
	fs.writeFileSync(path.join(runDir, 'crawl-result.json'), JSON.stringify(manifest));
	fs.writeFileSync(
		path.join(root, 'screenshots', 'v1.2.0', 'release-run.json'),
		JSON.stringify({ run }),
	);
};

export const tagRefLineFor = (commit: string): string =>
	`refs/tags/v1.2.0 ${commit} refs/tags/v1.2.0 0000000000000000000000000000000000000000`;
