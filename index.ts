#!/usr/bin/env -S bun --no-env-file

import { pathToFileURL } from 'node:url';

import { CliError, HELP_TEXT } from './src/cli.ts';
import { formatErrorMessage } from './src/reporting.ts';
import { run } from './src/run.ts';

const isMainModule =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
	try {
		process.exitCode = run();
	} catch (err) {
		console.error(formatErrorMessage(err));
		if (err instanceof CliError) {
			console.error(HELP_TEXT);
			process.exitCode = 2;
		} else {
			process.exitCode = 1;
		}
	}
}
