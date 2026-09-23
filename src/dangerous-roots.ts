import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Cleanup-root denylist: protected OS trees (equal or descendant) and exact-only
 * user-container / home roots. Private to the safety pipeline — not a package export.
 */

const normalize = (candidatePath: string): string => {
	const resolved = path.resolve(candidatePath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** OS trees rejected when the candidate is equal to or under the path. */
const WIN_PROTECTED_TREES = [
	'C:\\Windows',
	'C:\\Program Files',
	'C:\\Program Files (x86)',
	'C:\\ProgramData',
];
/** User-container roots rejected only as exact matches (descendants stay allowed). */
const WIN_EXACT_ONLY = ['C:\\Users'];

const POSIX_PROTECTED_TREES = [
	'/bin',
	'/boot',
	'/dev',
	'/etc',
	'/lib',
	'/lib64',
	'/opt',
	'/proc',
	'/root',
	'/sbin',
	'/srv',
	'/sys',
	'/usr',
	'/var',
];
const POSIX_EXACT_ONLY = ['/home', '/Users'];

const PROTECTED_TREES: string[] = (
	process.platform === 'win32' ? WIN_PROTECTED_TREES : POSIX_PROTECTED_TREES
).map(normalize);

const EXACT_ONLY_ROOTS: Set<string> = new Set(
	[...(process.platform === 'win32' ? WIN_EXACT_ONLY : POSIX_EXACT_ONLY), os.homedir()].map(
		normalize,
	),
);

const isFilesystemRoot = (candidatePath: string): boolean => {
	const resolved = path.resolve(candidatePath);
	return normalize(resolved) === normalize(path.parse(resolved).root);
};

const isWithinOrEqual = (candidatePath: string, rootPath: string): boolean => {
	const relative = path.relative(rootPath, candidatePath);
	return (
		relative === '' ||
		(!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
	);
};

const isProtectedTreePath = (candidatePath: string): boolean => {
	const normalized = normalize(candidatePath);
	return PROTECTED_TREES.some((tree) => isWithinOrEqual(normalized, tree));
};

/** True when a cleanup root must be refused before planning continues. */
export const isDangerousRootPath = (candidatePath: string): boolean => {
	const normalized = normalize(candidatePath);
	return (
		isFilesystemRoot(candidatePath) ||
		isProtectedTreePath(candidatePath) ||
		EXACT_ONLY_ROOTS.has(normalized)
	);
};
