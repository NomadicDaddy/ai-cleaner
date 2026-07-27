export const HELP_TEXT = `AI Cleaner - routine harness/session cleanup with retention policies.

Usage:
  ai-cleaner [options]

Options:
  --config <path>         Path to config JSON (default: bundled config.json)
  --dry-run               Print actions without deleting (default)
  --apply                 Delete selected artifacts
  --aggressive            Process targets marked risk: aggressive
  --confirm-aggressive    Confirm aggressive deletion (required with --apply --aggressive)
  --help, -h              Show this help

See config.json and README.md for the configuration format.`;

export interface CliOptions {
	aggressive: boolean;
	apply: boolean;
	confirmAggressive: boolean;
	configPath?: string;
	help: boolean;
}

export class CliError extends Error {}

export const parseArgs = (): CliOptions => {
	const args = process.argv.slice(2);
	const options: CliOptions = {
		aggressive: false,
		apply: false,
		confirmAggressive: false,
		help: false,
	};
	let explicitDryRun = false;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === undefined) {
			continue;
		}
		if (argument === '--dry-run') {
			explicitDryRun = true;
		} else if (argument === '--apply') {
			options.apply = true;
		} else if (argument === '--aggressive') {
			options.aggressive = true;
		} else if (argument === '--confirm-aggressive') {
			options.confirmAggressive = true;
		} else if (argument === '--config') {
			const next = args[index + 1];
			if (next === undefined || next.startsWith('-')) {
				throw new CliError('--config requires a path argument.');
			}
			options.configPath = next;
			index++;
		} else if (argument === '--help' || argument === '-h') {
			options.help = true;
		} else {
			throw new CliError(`Unknown argument: ${argument}`);
		}
	}
	if (explicitDryRun && options.apply) {
		throw new CliError('--dry-run and --apply cannot be used together.');
	}
	return options;
};
