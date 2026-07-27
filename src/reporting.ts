/**
 * CLI message rendering. Owns the conversion of internal state and errors into
 * console output. Untrusted values are currently interpolated verbatim; the
 * console-output-escaping remediation will add a visible-encoding contract here.
 */
export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
