import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { formatLogValue } from '../src/reporting.ts';
import {
	cleanupTemporaryRoots,
	createTemporaryRoot,
	type TestTarget,
	runCli,
	writeConfig,
} from './cli-fixture.ts';

afterEach(cleanupTemporaryRoots);

const NUL = '\u0000';
const ESC = '\u001b';
const DEL = '\u007f';
const NEWLINE = '\n';
const CR = '\r';
const TAB = '\t';
const BS = '\\';

describe('formatLogValue encoding contract', () => {
	test('leaves printable ASCII and Unicode unchanged', () => {
		expect(formatLogValue('normal/path.txt')).toBe('normal/path.txt');
		expect(formatLogValue('café-文字-🎉')).toBe('café-文字-🎉');
		expect(formatLogValue('')).toBe('');
	});

	test('renders backslash as \\\\', () => {
		expect(formatLogValue(`C:${BS}Users${BS}test`)).toBe(`C:${BS}${BS}Users${BS}${BS}test`);
	});

	test('renders newline, carriage return, and tab as visible sequences', () => {
		expect(formatLogValue(NEWLINE)).toBe(`${BS}n`);
		expect(formatLogValue(CR)).toBe(`${BS}r`);
		expect(formatLogValue(TAB)).toBe(`${BS}t`);
	});

	test('renders NUL, ESC, and DEL as \\u00XX', () => {
		expect(formatLogValue(NUL)).toBe(`${BS}u0000`);
		expect(formatLogValue(ESC)).toBe(`${BS}u001b`);
		expect(formatLogValue(DEL)).toBe(`${BS}u007f`);
	});

	test('renders every C0 control as \\u00XX', () => {
		for (let code = 0x01; code <= 0x1f; code++) {
			if (code === 0x0a || code === 0x0d || code === 0x09) {
				continue; // newline, CR, tab have named sequences
			}
			const char = String.fromCharCode(code);
			const encoded = formatLogValue(char);
			expect(encoded).toBe(`${BS}u${code.toString(16).padStart(4, '0')}`);
		}
	});

	test('emits no raw U+0000 through U+001F or U+007F', () => {
		const malicious = `evil${NUL}name${ESC}${DEL}${NEWLINE}forged${CR}record${TAB}${BS}`;
		const encoded = formatLogValue(malicious);
		for (let code = 0x00; code <= 0x1f; code++) {
			expect(encoded).not.toContain(String.fromCharCode(code));
		}
		expect(encoded).not.toContain(String.fromCharCode(0x7f));
	});

	test('keeps each event one logical record', () => {
		const injected = `name${NEWLINE}[OK] operation succeeded`;
		const encoded = formatLogValue(injected);
		const lines = encoded.split(NEWLINE);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(`${BS}n`);
	});
});

describe('malicious target names and tool names in preview output', () => {
	test('escapes newline-injected target name and tool in dry-run analysis', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		fs.writeFileSync(path.join(artifactRoot, 'old.log'), 'old');

		const maliciousName = `evil${NEWLINE}forged`;
		const maliciousTool = `tool${TAB}inject`;
		const targets: TestTarget[] = [
			{
				kind: 'any',
				name: maliciousName,
				paths: [artifactRoot],
				retention: { allowEmpty: true, keepCount: 0 },
				tool: maliciousTool,
			},
		];
		const configPath = writeConfig(root, targets);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain(`/${NEWLINE}forged`);
		expect(result.stdout).toContain(`${BS}n`);
		expect(result.stdout).toContain(`${BS}t`);
	});

	test('escapes ESC, NUL, DEL, CR, and backslash in target labels', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		fs.writeFileSync(path.join(artifactRoot, 'old.log'), 'old');

		const maliciousName = `n${ESC}ame${NUL}${DEL}${CR}${BS}`;
		const targets: TestTarget[] = [
			{
				kind: 'any',
				name: maliciousName,
				paths: [artifactRoot],
				retention: { allowEmpty: true, keepCount: 0 },
				tool: 'test',
			},
		];
		const configPath = writeConfig(root, targets);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(`${BS}u001b`);
		expect(result.stdout).toContain(`${BS}u0000`);
		expect(result.stdout).toContain(`${BS}u007f`);
		expect(result.stdout).toContain(`${BS}r`);
		expect(result.stdout).toContain(`${BS}${BS}`);
	});

	test('escapes newline-injected tool and name in skip output', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		fs.writeFileSync(path.join(artifactRoot, 'old.log'), 'old');

		const configPath = writeConfig(root, [
			{
				kind: 'any',
				name: `Skip${NEWLINE}Me`,
				paths: [artifactRoot],
				retention: { allowEmpty: true, keepCount: 0 },
				risk: 'aggressive',
				tool: `Agg${TAB}ro`,
			},
		]);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Skipping aggressive target:');
		expect(result.stdout).toContain(`${BS}n`);
		expect(result.stdout).toContain(`${BS}t`);
		// No forged standalone record
		const lines = result.stdout.split(NEWLINE);
		expect(lines.some((line) => line === 'Me...')).toBeFalse();
	});
});

describe('malicious configured paths in error output', () => {
	test('escapes newline in unavailable environment variable path', async () => {
		const root = createTemporaryRoot();
		const maliciousPath = `$MISSING_VAR/path${NEWLINE}forged`;
		const configPath = path.join(root, 'config.json');
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				targets: [
					{
						kind: 'any',
						name: 'Test',
						paths: [maliciousPath],
						retention: { allowEmpty: true, keepCount: 0 },
						tool: 'test',
					},
				],
			})
		);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('unavailable environment variable');
		expect(result.stderr).toContain(`${BS}n`);
		expect(result.stderr).not.toContain(`path${NEWLINE}forged`);
	});

	test('escapes NUL and ESC in unknown config field error', async () => {
		const root = createTemporaryRoot();
		const configPath = path.join(root, 'malicious.json');
		const maliciousField = `surprise${ESC}${NUL}`;
		fs.writeFileSync(configPath, JSON.stringify({ [maliciousField]: true }));

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('unknown field');
		expect(result.stderr).toContain(`${BS}u001b`);
		expect(result.stderr).toContain(`${BS}u0000`);
	});

	test('escapes DEL and backslash in unknown preset name error', async () => {
		const root = createTemporaryRoot();
		const configPath = path.join(root, 'preset.json');
		const maliciousPreset = `bad${DEL}${BS}`;
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				usePresets: [maliciousPreset],
			})
		);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('unknown preset');
		expect(result.stderr).toContain(`${BS}u007f`);
		expect(result.stderr).toContain(`${BS}${BS}`);
	});
});

describe('malicious artifact paths through formatLogValue', () => {
	test('formatLogValue escapes control chars that could appear in artifact paths', () => {
		const artifactPaths = [
			`/tmp/agent/session${NEWLINE}evil`,
			`/tmp/agent/file${CR}name`,
			`/tmp/agent/dir${TAB}tab`,
			`/tmp/agent/esc${ESC}seq`,
			`/tmp/agent/nul${NUL}byte`,
			`/tmp/agent/del${DEL}char`,
			`C:${BS}Users${BS}path`,
		];
		for (const artifactPath of artifactPaths) {
			const encoded = formatLogValue(artifactPath);
			for (let code = 0x00; code <= 0x1f; code++) {
				expect(encoded).not.toContain(String.fromCharCode(code));
			}
			expect(encoded).not.toContain(String.fromCharCode(0x7f));
			expect(encoded.split(NEWLINE)).toHaveLength(1);
		}
	});

	test('escaped artifact paths retain printable label text', () => {
		const malicious = `/home/user/.agent/logs/session${NEWLINE}evil/session-001`;
		const encoded = formatLogValue(malicious);
		expect(encoded).toContain('/home/user/.agent/logs/');
		expect(encoded).toContain('session');
		expect(encoded).toContain('evil');
		expect(encoded).toContain('session-001');
	});
});

describe('malicious protected-descendant paths through formatLogValue', () => {
	test('formatLogValue escapes protected-descendant descriptions', () => {
		const descriptions = [
			`sensitive path /tmp/session${NEWLINE}.env`,
			`symbolic link or junction /tmp/link${ESC}${DEL}`,
			`sensitive path /tmp/${NUL}secret/credentials`,
		];
		for (const description of descriptions) {
			const encoded = formatLogValue(description);
			for (let code = 0x00; code <= 0x1f; code++) {
				expect(encoded).not.toContain(String.fromCharCode(code));
			}
			expect(encoded).not.toContain(String.fromCharCode(0x7f));
			expect(encoded.split(NEWLINE)).toHaveLength(1);
		}
	});
});

describe('output escaping does not alter behavior', () => {
	test('exit codes, summary totals, and deletion count are unchanged', async () => {
		const root = createTemporaryRoot();
		const artifactRoot = path.join(root, 'artifacts');
		fs.mkdirSync(artifactRoot);
		const artifact = path.join(artifactRoot, 'old.log');
		fs.writeFileSync(artifact, 'old');
		const configPath = writeConfig(root, [
			{
				kind: 'any',
				name: 'Test',
				paths: [artifactRoot],
				retention: { allowEmpty: true, keepCount: 0 },
				tool: 'test',
			},
		]);

		const result = await runCli(['--config', configPath, '--apply']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Matched for deletion: 1');
		expect(result.stdout).toContain('Skipped: 0');
		expect(result.stdout).toContain('Failed or refused: 0');
		expect(fs.existsSync(artifact)).toBeFalse();
	});

	test('disabled and aggressive-skip counts are unchanged', async () => {
		const root = createTemporaryRoot();
		const disabledRoot = path.join(root, 'disabled-artifacts');
		const aggressiveRoot = path.join(root, 'aggressive-artifacts');
		fs.mkdirSync(disabledRoot);
		fs.mkdirSync(aggressiveRoot);
		fs.writeFileSync(path.join(disabledRoot, 'old.log'), 'old');
		fs.writeFileSync(path.join(aggressiveRoot, 'old.log'), 'old');
		const configPath = writeConfig(root, [
			{
				enabled: false,
				kind: 'any',
				name: 'Disabled',
				paths: [disabledRoot],
				retention: { allowEmpty: true, keepCount: 0 },
				tool: 'test',
			},
			{
				kind: 'any',
				name: 'Aggressive',
				paths: [aggressiveRoot],
				retention: { allowEmpty: true, keepCount: 0 },
				risk: 'aggressive',
				tool: 'test',
			},
		]);

		const result = await runCli(['--config', configPath]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('Skipped: 2');
		expect(result.stdout).toContain('Matched for deletion: 0');
	});
});
