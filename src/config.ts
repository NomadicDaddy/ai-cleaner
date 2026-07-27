import * as fs from 'node:fs';
import * as path from 'node:path';

import bundledConfig from '../config.json' with { type: 'json' };
import { errorMessage, formatLogValue } from './reporting.ts';

export type ArtifactKind = 'directory' | 'file' | 'any';
export type RiskLevel = 'normal' | 'aggressive';

export interface RetentionPolicy {
	keepCount?: number;
	keepDays?: number;
	allowEmpty?: boolean;
}

export interface CleanupTarget {
	name: string;
	tool: string;
	paths: string[];
	kind?: ArtifactKind;
	retention?: RetentionPolicy;
	enabled?: boolean;
	risk?: RiskLevel;
}

export interface Config {
	aggressive?: boolean;
	defaultRetention?: RetentionPolicy;
	overrides?: Record<string, RetentionPolicy>;
	presets?: Record<string, CleanupTarget[]>;
	targetPaths?: string[];
	targets?: CleanupTarget[];
	usePresets?: string[];
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepCount: 5 };
const ARTIFACT_KINDS = new Set<ArtifactKind>(['directory', 'file', 'any']);
const RISK_LEVELS = new Set<RiskLevel>(['normal', 'aggressive']);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
	if (!isRecord(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value;
};

const assertAllowedKeys = (
	value: Record<string, unknown>,
	allowedKeys: readonly string[],
	label: string
): void => {
	const allowed = new Set(allowedKeys);
	const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
	if (unknownKey !== undefined) {
		throw new Error(`${label} contains unknown field: ${formatLogValue(unknownKey)}.`);
	}
};

const parseNonEmptyString = (value: unknown, label: string): string => {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	return value;
};

const parseBoolean = (value: unknown, label: string): boolean => {
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean.`);
	}
	return value;
};

const parseStringArray = (value: unknown, label: string, allowEmpty = true): string[] => {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
		throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array.`);
	}
	const values = value.map((entry, index) => parseNonEmptyString(entry, `${label}[${index}]`));
	if (new Set(values).size !== values.length) {
		throw new Error(`${label} must not contain duplicate values.`);
	}
	return values;
};

const parseRetentionPolicy = (value: unknown, label: string): RetentionPolicy => {
	const policy = assertRecord(value, label);
	assertAllowedKeys(policy, ['keepCount', 'keepDays', 'allowEmpty'], label);
	const keepCount = policy.keepCount;
	const keepDays = policy.keepDays;
	if (keepCount === undefined && keepDays === undefined) {
		throw new Error(`${label} must define keepCount or keepDays.`);
	}
	if (keepCount !== undefined && keepDays !== undefined) {
		throw new Error(`${label} must not define both keepCount and keepDays.`);
	}
	if (
		keepCount !== undefined &&
		(typeof keepCount !== 'number' || !Number.isInteger(keepCount) || keepCount < 0)
	) {
		throw new Error(`${label}.keepCount must be a non-negative integer.`);
	}
	if (
		keepDays !== undefined &&
		(typeof keepDays !== 'number' || !Number.isFinite(keepDays) || keepDays < 0)
	) {
		throw new Error(`${label}.keepDays must be a non-negative number.`);
	}
	let allowEmpty: boolean | undefined;
	if (policy.allowEmpty !== undefined) {
		allowEmpty = parseBoolean(policy.allowEmpty, `${label}.allowEmpty`);
	}
	if (keepCount === 0 && allowEmpty !== true) {
		throw new Error(
			`${label}.keepCount is 0 (would delete all matching artifacts). ` +
				'Set allowEmpty: true on the policy to confirm.'
		);
	}
	const parsedPolicy: RetentionPolicy = {};
	if (keepCount !== undefined) parsedPolicy.keepCount = keepCount;
	if (keepDays !== undefined) parsedPolicy.keepDays = keepDays;
	if (allowEmpty !== undefined) parsedPolicy.allowEmpty = allowEmpty;
	return parsedPolicy;
};

const isArtifactKind = (value: string): value is ArtifactKind =>
	ARTIFACT_KINDS.has(value as ArtifactKind);

const isRiskLevel = (value: string): value is RiskLevel => RISK_LEVELS.has(value as RiskLevel);

const parseCleanupTarget = (value: unknown, label: string): CleanupTarget => {
	const target = assertRecord(value, label);
	assertAllowedKeys(
		target,
		['name', 'tool', 'paths', 'kind', 'retention', 'enabled', 'risk'],
		label
	);
	const kind = target.kind;
	if (kind !== undefined && (typeof kind !== 'string' || !isArtifactKind(kind))) {
		throw new Error(`${label}.kind must be directory, file, or any.`);
	}
	const risk = target.risk;
	if (risk !== undefined && (typeof risk !== 'string' || !isRiskLevel(risk))) {
		throw new Error(`${label}.risk must be normal or aggressive.`);
	}
	const parsedTarget: CleanupTarget = {
		name: parseNonEmptyString(target.name, `${label}.name`),
		tool: parseNonEmptyString(target.tool, `${label}.tool`),
		paths: parseStringArray(target.paths, `${label}.paths`, false),
	};
	if (kind !== undefined) parsedTarget.kind = kind;
	if (target.retention !== undefined) {
		parsedTarget.retention = parseRetentionPolicy(target.retention, `${label}.retention`);
	}
	if (target.enabled !== undefined) {
		parsedTarget.enabled = parseBoolean(target.enabled, `${label}.enabled`);
	}
	if (risk !== undefined) parsedTarget.risk = risk;
	return parsedTarget;
};

export const parseConfig = (value: unknown): Config => {
	const config = assertRecord(value, 'config');
	assertAllowedKeys(
		config,
		[
			'aggressive',
			'defaultRetention',
			'overrides',
			'presets',
			'targetPaths',
			'targets',
			'usePresets',
		],
		'config'
	);

	let overrides: Record<string, RetentionPolicy> | undefined;
	if (config.overrides !== undefined) {
		const rawOverrides = assertRecord(config.overrides, 'overrides');
		overrides = {};
		for (const [name, policy] of Object.entries(rawOverrides)) {
			parseNonEmptyString(name, 'overrides key');
			overrides[name] = parseRetentionPolicy(policy, `overrides.${formatLogValue(name)}`);
		}
	}

	let presets: Record<string, CleanupTarget[]> | undefined;
	if (config.presets !== undefined) {
		const rawPresets = assertRecord(config.presets, 'presets');
		presets = {};
		for (const [name, targets] of Object.entries(rawPresets)) {
			parseNonEmptyString(name, 'presets key');
			if (!Array.isArray(targets)) {
				throw new Error(`presets.${formatLogValue(name)} must be an array of targets.`);
			}
			presets[name] = targets.map((target, index) =>
				parseCleanupTarget(target, `presets.${formatLogValue(name)}[${index}]`)
			);
		}
	}

	let targets: CleanupTarget[] | undefined;
	if (config.targets !== undefined) {
		if (!Array.isArray(config.targets)) {
			throw new Error('targets must be an array.');
		}
		targets = config.targets.map((target, index) =>
			parseCleanupTarget(target, `targets[${index}]`)
		);
	}
	let usePresets: string[] | undefined;
	if (config.usePresets !== undefined) {
		usePresets = parseStringArray(config.usePresets, 'usePresets');
	}
	for (const presetName of usePresets ?? []) {
		if (presets?.[presetName] === undefined) {
			throw new Error(`usePresets references unknown preset: ${formatLogValue(presetName)}.`);
		}
	}

	const parsedConfig: Config = {};
	if (config.aggressive !== undefined) {
		parsedConfig.aggressive = parseBoolean(config.aggressive, 'aggressive');
	}
	if (config.defaultRetention !== undefined) {
		parsedConfig.defaultRetention = parseRetentionPolicy(
			config.defaultRetention,
			'defaultRetention'
		);
	}
	if (overrides !== undefined) parsedConfig.overrides = overrides;
	if (presets !== undefined) parsedConfig.presets = presets;
	if (config.targetPaths !== undefined) {
		parsedConfig.targetPaths = parseStringArray(config.targetPaths, 'targetPaths');
	}
	if (targets !== undefined) parsedConfig.targets = targets;
	if (usePresets !== undefined) parsedConfig.usePresets = usePresets;
	return parsedConfig;
};

export const loadBundledConfig = (): Config => parseConfig(bundledConfig);

export const loadConfig = (configPath: string): Config => {
	const fullPath = path.resolve(process.cwd(), configPath);
	let raw: string;
	try {
		raw = fs.readFileSync(fullPath, 'utf8');
	} catch (err) {
		throw new Error(`Failed to read config ${formatLogValue(fullPath)}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (err) {
		throw new Error(`Invalid JSON in ${formatLogValue(fullPath)}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
	return parseConfig(parsed);
};
