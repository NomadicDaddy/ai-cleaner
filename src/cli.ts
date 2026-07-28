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

interface ParseState {
	args: string[];
	explicitDryRun: boolean;
	index: number;
	options: CliOptions;
}

type FlagHandler = (state: ParseState) => void;

const requireConfigPath = (state: ParseState): string => {
	const next = state.args[state.index + 1];
	if (next === undefined || next.startsWith('-')) {
		throw new CliError('--config requires a path argument.');
	}
	state.index++;
	return next;
};

const FLAG_HANDLERS: Record<string, FlagHandler> = {
	'--dry-run': (state) => {
		state.explicitDryRun = true;
	},
	'--apply': (state) => {
		state.options.apply = true;
	},
	'--aggressive': (state) => {
		state.options.aggressive = true;
	},
	'--confirm-aggressive': (state) => {
		state.options.confirmAggressive = true;
	},
	'--config': (state) => {
		state.options.configPath = requireConfigPath(state);
	},
	'--help': (state) => {
		state.options.help = true;
	},
	'-h': (state) => {
		state.options.help = true;
	},
};

export const parseArgs = (): CliOptions => {
	const state: ParseState = {
		args: process.argv.slice(2),
		explicitDryRun: false,
		index: 0,
		options: {
			aggressive: false,
			apply: false,
			confirmAggressive: false,
			help: false,
		},
	};

	for (; state.index < state.args.length; state.index++) {
		const argument = state.args[state.index];
		if (argument === undefined) {
			continue;
		}
		const handler = FLAG_HANDLERS[argument];
		if (handler === undefined) {
			throw new CliError(`Unknown argument: ${argument}`);
		}
		handler(state);
	}
	if (state.explicitDryRun && state.options.apply) {
		throw new CliError('--dry-run and --apply cannot be used together.');
	}
	return state.options;
};
