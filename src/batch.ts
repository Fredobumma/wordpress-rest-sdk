/**
 * `/batch/v1` runs up to 25 writes in one HTTP request. Only routes registered
 * with `allow_batch` accept it, which the generated route map records.
 */

import { type FailedRequest, isErrorBody, WordPressError } from './errors.js';
import type { Method } from './types.js';

/** WordPress's default `rest_get_max_batch_size`. */
export const MAX_BATCH_SIZE = 25;

/**
 * A request built but not sent, from `client.prepare()`. The type parameters
 * carry its response type and whether `/batch/v1` accepts it.
 */
export interface PreparedRequest<T = unknown, Batchable extends boolean = boolean> {
	readonly method: Method;
	/** The path under the API root, with any query string, such as `/wp/v2/posts/7?force=true`. */
	readonly path: string;
	readonly body?: Record<string, unknown>;
	/** @internal Carries the response type. */
	readonly __response?: T;
	/** @internal Carries whether the route can be batched. */
	readonly __batchable?: Batchable;
}

/** The outcome of one request in a batch. */
export type BatchResult<T> =
	| { ok: true; status: number; data: T; headers: Record<string, string> }
	| { ok: false; status: number; error: WordPressError; headers: Record<string, string> };

export interface BatchOptions {
	/**
	 * `require-all-validate` checks every request before running any, and
	 * throws `WordPressBatchValidationError` if one fails. `normal`, the
	 * default, runs each request on its own.
	 */
	validation?: 'normal' | 'require-all-validate';
}

/** Raised when `require-all-validate` stopped a batch before anything ran. */
export class WordPressBatchValidationError extends Error {
	static {
		WordPressBatchValidationError.prototype.name = 'WordPressBatchValidationError';
	}

	/** The validation error for each request, in order, or `null` for those that were valid. */
	readonly errors: Array<WordPressError | null>;

	constructor(errors: Array<WordPressError | null>) {
		const failed = errors.filter((error) => error !== null).length;
		super(`${failed} of ${errors.length} batch requests failed validation, so none were run`);
		this.errors = errors;
	}
}

interface Envelope {
	body: unknown;
	status: number;
	headers?: Record<string, string> | unknown[];
}

interface BatchResponse {
	failed?: 'validation';
	responses: Array<Envelope | null>;
}

function headersOf(envelope: Envelope): Record<string, string> {
	return envelope.headers && !Array.isArray(envelope.headers) ? envelope.headers : {};
}

function asError(body: unknown, status: number, request: FailedRequest): WordPressError {
	return new WordPressError(
		isErrorBody(body) ? body : { code: 'unknown_error', message: `HTTP ${status}` },
		status,
		request,
	);
}

/** Turns a `/batch/v1` response into one result per request. */
export function readBatch(
	response: BatchResponse,
	requests: readonly PreparedRequest[],
	url: (path: string) => string,
): BatchResult<unknown>[] {
	const describe = (i: number): FailedRequest => ({
		method: requests[i]?.method ?? 'POST',
		url: url(requests[i]?.path ?? '/'),
	});

	if (response.failed === 'validation') {
		throw new WordPressBatchValidationError(
			response.responses.map((envelope, i) => {
				if (!envelope) return null;
				// Validation failures arrive enveloped, or as a bare error body.
				const body = 'body' in envelope ? envelope.body : envelope;
				return asError(body, envelope.status ?? 400, describe(i));
			}),
		);
	}

	return response.responses.map((envelope, i): BatchResult<unknown> => {
		const status = envelope?.status ?? 500;
		const headers = envelope ? headersOf(envelope) : {};
		if (envelope && status < 400) return { ok: true, status, data: envelope.body, headers };
		return { ok: false, status, error: asError(envelope?.body, status, describe(i)), headers };
	});
}
