import * as fs from 'node:fs';
import * as path from 'node:path';

import { errorMessage } from './reporting.ts';

/**
 * Reads and parses a custom configuration file resolved from the current
 * working directory. Read and JSON.parse failures keep their current messages
 * and causes so emission-time encoding stays single-pass.
 */
export const readConfigValue = (configPath: string): unknown => {
	const fullPath = path.resolve(process.cwd(), configPath);
	let raw: string;
	try {
		raw = fs.readFileSync(fullPath, 'utf8');
	} catch (err) {
		// Path and nested message stay raw so formatErrorMessage at emission encodes once.
		throw new Error(`Failed to read config ${fullPath}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch (err) {
		throw new Error(`Invalid JSON in ${fullPath}: ${errorMessage(err)}`, {
			cause: err,
		});
	}
};
