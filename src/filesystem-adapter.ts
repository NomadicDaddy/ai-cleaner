import * as fs from 'node:fs';

/**
 * Internal filesystem adapter that wraps every blocking filesystem call used by
 * the safety pipeline. Threading this through run.ts lets the release-
 * verification test inject lstat, readdir, realpath, and rm failures and swap
 * artifacts between containment checks without touching the real filesystem.
 */
export interface FilesystemAdapter {
	lstatSync: (path: string) => fs.Stats;
	readdirSync: (path: string) => fs.Dirent[];
	realpathSync: (path: string) => string;
	rmSync: (path: string, options: { force: boolean; recursive: boolean }) => void;
}

export const defaultFilesystemAdapter: FilesystemAdapter = {
	lstatSync: (p) => fs.lstatSync(p),
	readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
	realpathSync: (p) => fs.realpathSync.native(p),
	rmSync: (p, options) => fs.rmSync(p, options),
};
