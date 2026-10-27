import type { ErrorBody } from './types.js';

/** The request a failure belongs to. */
export interface FailedRequest {
	method: string;
	url: string;
}

/**
 * WordPress answered with an error, such as `rest_post_invalid_id` or
 * `rest_forbidden`. `code` is stable across languages; `message` is translated.
 */
export class WordPressError extends Error {
	static {
		WordPressError.prototype.name = 'WordPressError';
	}

	/** WordPress's error code, such as `rest_forbidden`. */
	readonly code: string;
	/** The HTTP status. */
	readonly status: number;
	/** Anything else WordPress sent with the error. */
	readonly data: ErrorBody['data'];
	readonly request: FailedRequest;

	constructor(body: ErrorBody, status: number, request: FailedRequest) {
		super(body.message || body.code);
		this.code = body.code;
		this.status = status;
		this.data = body.data ?? null;
		this.request = request;
	}

	/** For `rest_invalid_param` and `rest_missing_callback_param`: a message per parameter. */
	get params(): Record<string, string> {
		const params = this.data?.params;
		if (Array.isArray(params)) return Object.fromEntries(params.map((name) => [String(name), 'Missing']));
		return params && typeof params === 'object' ? params : {};
	}
}

/**
 * The response wasn't the JSON WordPress sends: an HTML page, PHP output
 * before the JSON, or an empty body where one was expected.
 */
export class WordPressResponseError extends Error {
	static {
		WordPressResponseError.prototype.name = 'WordPressResponseError';
	}

	readonly status: number;
	/** The start of the body, for diagnosis. */
	readonly body: string;
	readonly request: FailedRequest;

	constructor(message: string, status: number, body: string, request: FailedRequest) {
		super(message);
		this.status = status;
		this.body = body.slice(0, 2000);
		this.request = request;
	}
}

/** The request didn't complete: the network failed, it timed out, or it was aborted. */
export class WordPressRequestError extends Error {
	static {
		WordPressRequestError.prototype.name = 'WordPressRequestError';
	}

	readonly request: FailedRequest;
	/** `true` when the client's `timeout` ran out. */
	readonly timedOut: boolean;

	constructor(message: string, request: FailedRequest, options: { cause?: unknown; timedOut?: boolean } = {}) {
		super(message, { cause: options.cause });
		this.request = request;
		this.timedOut = options.timedOut ?? false;
	}
}

/** `true` for an error WordPress sent, optionally with a specific code. */
export function isWordPressError(error: unknown, code?: string): error is WordPressError {
	return error instanceof WordPressError && (code === undefined || error.code === code);
}

export function isErrorBody(value: unknown): value is ErrorBody {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as ErrorBody).code === 'string' &&
		typeof (value as ErrorBody).message === 'string'
	);
}
