/**
 * Terminal output. No dependency — a CLI that installs things on someone's
 * machine should be auditable in one sitting, so the whole package carries a
 * single runtime dependency and this is not it.
 */

const useColor =
	!process.env.NO_COLOR && process.env.TERM !== 'dumb' && process.stdout.isTTY === true;

const wrap = (code: string) => (text: string) => (useColor ? `[${code}m${text}[0m` : text);

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const cyan = wrap('36');

export const info = (message: string): void => console.log(message);
export const step = (message: string): void => console.log(`${cyan('›')} ${message}`);
export const success = (message: string): void => console.log(`${green('✓')} ${message}`);
export const warn = (message: string): void => console.warn(`${yellow('!')} ${message}`);
export const blank = (): void => console.log('');

/** Written to stderr so `cloudflarebase ... > file` still shows failures. */
export const error = (message: string): void => console.error(`${red('✗')} ${message}`);

/**
 * A failure that is the user's to fix — a missing config, a name that is
 * already taken. Reported as a plain message with no stack trace, because a
 * stack tells them nothing they can act on.
 */
export class UserError extends Error {
	readonly hint?: string;

	constructor(message: string, hint?: string) {
		super(message);
		this.name = 'UserError';
		this.hint = hint;
	}
}
