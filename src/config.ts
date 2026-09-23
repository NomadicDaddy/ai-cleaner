import bundledConfig from '../config.json' with { type: 'json' };
import { readConfigValue } from './config-file.ts';

export type ArtifactKind = 'directory' | 'file' | 'any';
type RiskLevel = 'normal' | 'aggressive';

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
const CONFIG_KEYS = [
	'aggressive',
	'defaultRetention',
	'overrides',
	'presets',
	'targetPaths',
	'targets',
	'usePresets',
] as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
	if (!isRecord(value)) throw new Error(`${label} must be an object.`);
	return value;
};

const assertAllowedKeys = (
	value: Record<string, unknown>,
	allowedKeys: readonly string[],
	label: string,
): void => {
	const allowed = new Set(allowedKeys);
	const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
	if (unknownKey !== undefined) {
		// Untrusted key stays raw; formatErrorMessage at stderr emission encodes it once.
		throw new Error(`${label} contains unknown field: ${unknownKey}.`);
	}
};

const parseNonEmptyString = (value: unknown, label: string): string => {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	return value;
};

const parseBoolean = (value: unknown, label: string): boolean => {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
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

const parseKeepCount = (keepCount: unknown, label: string): number => {
	if (typeof keepCount !== 'number' || !Number.isInteger(keepCount) || keepCount < 0) {
		throw new Error(`${label}.keepCount must be a non-negative integer.`);
	}
	return keepCount;
};

const parseKeepDays = (keepDays: unknown, label: string): number => {
	if (typeof keepDays !== 'number' || !Number.isFinite(keepDays) || keepDays < 0) {
		throw new Error(`${label}.keepDays must be a non-negative number.`);
	}
	return keepDays;
};

const assertExclusiveRetention = (keepCount: unknown, keepDays: unknown, label: string): void => {
	if (keepCount === undefined && keepDays === undefined) {
		throw new Error(`${label} must define keepCount or keepDays.`);
	}
	if (keepCount !== undefined && keepDays !== undefined) {
		throw new Error(`${label} must not define both keepCount and keepDays.`);
	}
};

const assertFullDeletionConfirmed = (
	keepCount: number | undefined,
	keepDays: number | undefined,
	allowEmpty: boolean | undefined,
	label: string,
): void => {
	if (keepCount === 0 && allowEmpty !== true) {
		throw new Error(
			`${label}.keepCount is 0 (would delete all matching artifacts). ` +
				'Set allowEmpty: true on the policy to confirm.',
		);
	}
	if (keepDays === 0 && allowEmpty !== true) {
		throw new Error(
			`${label}.keepDays is 0 (would delete all matching artifacts). ` +
				'Set allowEmpty: true on the policy to confirm.',
		);
	}
};

const parseRetentionPolicy = (value: unknown, label: string): RetentionPolicy => {
	const policy = assertRecord(value, label);
	assertAllowedKeys(policy, ['keepCount', 'keepDays', 'allowEmpty'], label);
	assertExclusiveRetention(policy.keepCount, policy.keepDays, label);
	const keepCount =
		policy.keepCount === undefined ? undefined : parseKeepCount(policy.keepCount, label);
	const keepDays =
		policy.keepDays === undefined ? undefined : parseKeepDays(policy.keepDays, label);
	const allowEmpty =
		policy.allowEmpty === undefined
			? undefined
			: parseBoolean(policy.allowEmpty, `${label}.allowEmpty`);
	assertFullDeletionConfirmed(keepCount, keepDays, allowEmpty, label);
	return {
		...(keepCount !== undefined ? { keepCount } : {}),
		...(keepDays !== undefined ? { keepDays } : {}),
		...(allowEmpty !== undefined ? { allowEmpty } : {}),
	};
};

const parseTargetKind = (kind: unknown, label: string): ArtifactKind | undefined => {
	if (kind === undefined) return undefined;
	if (typeof kind !== 'string' || !ARTIFACT_KINDS.has(kind as ArtifactKind)) {
		throw new Error(`${label}.kind must be directory, file, or any.`);
	}
	return kind as ArtifactKind;
};

const parseTargetRisk = (risk: unknown, label: string): RiskLevel | undefined => {
	if (risk === undefined) return undefined;
	if (typeof risk !== 'string' || !RISK_LEVELS.has(risk as RiskLevel)) {
		throw new Error(`${label}.risk must be normal or aggressive.`);
	}
	return risk as RiskLevel;
};

const parseCleanupTarget = (value: unknown, label: string): CleanupTarget => {
	const target = assertRecord(value, label);
	assertAllowedKeys(
		target,
		['name', 'tool', 'paths', 'kind', 'retention', 'enabled', 'risk'],
		label,
	);
	const kind = parseTargetKind(target.kind, label);
	const risk = parseTargetRisk(target.risk, label);
	const parsed: CleanupTarget = {
		name: parseNonEmptyString(target.name, `${label}.name`),
		tool: parseNonEmptyString(target.tool, `${label}.tool`),
		paths: parseStringArray(target.paths, `${label}.paths`, false),
	};
	if (kind !== undefined) parsed.kind = kind;
	if (target.retention !== undefined) {
		parsed.retention = parseRetentionPolicy(target.retention, `${label}.retention`);
	}
	if (target.enabled !== undefined) {
		parsed.enabled = parseBoolean(target.enabled, `${label}.enabled`);
	}
	if (risk !== undefined) parsed.risk = risk;
	return parsed;
};

const parseOverrides = (value: unknown): Record<string, RetentionPolicy> => {
	const raw = assertRecord(value, 'overrides');
	// Null prototype: `constructor`, `toString`, and `__proto__` keys must land as own
	// entries instead of colliding with inherited Object.prototype properties.
	const overrides: Record<string, RetentionPolicy> = Object.create(null);
	for (const [name, policy] of Object.entries(raw)) {
		parseNonEmptyString(name, 'overrides key');
		// Labels stay raw; formatErrorMessage at stderr emission encodes them once.
		overrides[name] = parseRetentionPolicy(policy, `overrides.${name}`);
	}
	return overrides;
};

const parsePresets = (value: unknown): Record<string, CleanupTarget[]> => {
	const raw = assertRecord(value, 'presets');
	// Null prototype: preset names that shadow inherited properties stay own entries.
	const presets: Record<string, CleanupTarget[]> = Object.create(null);
	for (const [name, targets] of Object.entries(raw)) {
		parseNonEmptyString(name, 'presets key');
		if (!Array.isArray(targets)) {
			throw new Error(`presets.${name} must be an array of targets.`);
		}
		presets[name] = targets.map((target, index) =>
			parseCleanupTarget(target, `presets.${name}[${index}]`),
		);
	}
	return presets;
};

const parseConfigTargets = (value: unknown): CleanupTarget[] => {
	if (!Array.isArray(value)) throw new Error('targets must be an array.');
	return value.map((target, index) => parseCleanupTarget(target, `targets[${index}]`));
};

const validateUsePresetRefs = (
	usePresets: string[],
	presets: Record<string, CleanupTarget[]> | undefined,
): void => {
	for (const presetName of usePresets) {
		// Own-property guard: an inherited name (e.g. `constructor`) must never
		// resolve to a preset that was not explicitly configured.
		if (presets === undefined || !Object.hasOwn(presets, presetName)) {
			throw new Error(`usePresets references unknown preset: ${presetName}.`);
		}
	}
};

interface ParsedConfigParts {
	overrides: Record<string, RetentionPolicy> | undefined;
	presets: Record<string, CleanupTarget[]> | undefined;
	targets: CleanupTarget[] | undefined;
	usePresets: string[] | undefined;
}

const parseConfigParts = (config: Record<string, unknown>): ParsedConfigParts => {
	const overrides = config.overrides === undefined ? undefined : parseOverrides(config.overrides);
	const presets = config.presets === undefined ? undefined : parsePresets(config.presets);
	const targets = config.targets === undefined ? undefined : parseConfigTargets(config.targets);
	const usePresets =
		config.usePresets === undefined
			? undefined
			: parseStringArray(config.usePresets, 'usePresets');
	if (usePresets !== undefined) validateUsePresetRefs(usePresets, presets);
	return { overrides, presets, targets, usePresets };
};

const assignConfigParts = (parsed: Config, parts: ParsedConfigParts): void => {
	if (parts.overrides !== undefined) parsed.overrides = parts.overrides;
	if (parts.presets !== undefined) parsed.presets = parts.presets;
	if (parts.targets !== undefined) parsed.targets = parts.targets;
	if (parts.usePresets !== undefined) parsed.usePresets = parts.usePresets;
};

const assembleConfig = (config: Record<string, unknown>, parts: ParsedConfigParts): Config => {
	const parsed: Config = {};
	if (config.aggressive !== undefined) {
		parsed.aggressive = parseBoolean(config.aggressive, 'aggressive');
	}
	if (config.defaultRetention !== undefined) {
		parsed.defaultRetention = parseRetentionPolicy(config.defaultRetention, 'defaultRetention');
	}
	if (config.targetPaths !== undefined) {
		parsed.targetPaths = parseStringArray(config.targetPaths, 'targetPaths');
	}
	assignConfigParts(parsed, parts);
	return parsed;
};

const parseConfig = (value: unknown): Config => {
	const config = assertRecord(value, 'config');
	assertAllowedKeys(config, CONFIG_KEYS, 'config');
	return assembleConfig(config, parseConfigParts(config));
};

export const loadBundledConfig = (): Config => parseConfig(bundledConfig);

export const loadConfig = (configPath: string): Config => parseConfig(readConfigValue(configPath));
