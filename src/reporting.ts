/**
 * CLI message rendering. Owns the conversion of internal state and errors into
 * console output. Untrusted configuration labels and filesystem paths are
 * passed through formatLogValue before interpolation so that control characters
 * cannot forge or alter terminal and captured-log output.
 */

/**
 * Escapes a single untrusted string for safe terminal and captured-log output.
 *
 * Leaves printable Unicode unchanged. Renders backslash as `\\`, newline,
 * carriage return, and tab as the visible sequences `\n`, `\r`, and `\t`, and
 * every other C0 control (U+0000–U+001F) or DEL (U+007F) as `\u00XX`. Guarantees
 * that no raw U+0000 through U+001F or U+007F from an untrusted value reaches
 * stdout or stderr, keeping each log event one logical record.
 */
export const formatLogValue = (value: string): string => {
	let result = '';
	for (const char of value) {
		const code = char.codePointAt(0)!;
		result +=
			char === '\\'
				? '\\\\'
				: char === '\n'
					? '\\n'
					: char === '\r'
						? '\\r'
						: char === '\t'
							? '\\t'
							: code <= 0x1f || code === 0x7f
								? `\\u${code.toString(16).padStart(4, '0')}`
								: char;
	}
	return result;
};

export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
