/**
 * Sends requests: auth, timeouts, retries, and turning responses into data or
 * errors. Uses only web APIs, so it runs in Node, browsers, Deno, Bun and
 * edge runtimes alike.
 */

import { type Auth, authorize } from './auth.js';
import {
	type FailedRequest,
	isErrorBody,
	WordPressError,
	WordPressRequestError,
	WordPressResponseError,
} from './errors.js';
import { toQuery } from './query.js';
import type { Method } from './types.js';
import { type ApiRoot, routeUrl } from './url.js';

export interface TransportConfig {
	root: ApiRoot;
	auth: Auth | undefined;
	fetch: typeof globalThis.fetch;
	headers: Headers;
	timeout: number;
	retries: number;
	methodOverride: boolean;
}

export interface Outgoing {
	method: Method;
	/** A path under the API root, such as `/wp/v2/posts/1`. */
	path: string;
	query?: Record<string, unknown>;
	/** Sent as JSON. */
	json?: unknown;
	/** Sent as is, such as a `FormData` upload. */
	body?: BodyInit;
	headers?: HeadersInit;
	signal?: AbortSignal;
	timeout?: number;
}

export interface Incoming<T = unknown> {
	data: T;
	status: number;
	headers: Headers;
}

/** Statuses worth retrying a GET for. */
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
/** Longer `Retry-After` waits are returned as errors instead of slept through. */
const MAX_RETRY_WAIT = 60_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/** How long to wait before retry number `attempt + 1`, or `null` to give up. */
function retryDelay(retryAfter: string | null, attempt: number): number | null {
	if (retryAfter) {
		const seconds = Number(retryAfter);
		const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
		if (Number.isFinite(ms)) return ms > MAX_RETRY_WAIT ? null : Math.max(ms, 0);
	}
	// Exponential backoff with jitter: about 0.5 s, 1 s, 2 s…
	return Math.min(500 * 2 ** attempt, 8000) * (0.75 + Math.random() / 2);
}

/** A readable excerpt of a body that should have been JSON. */
function excerpt(text: string): string {
	const plain = text
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/ ([:;,.])/g, '$1')
		.trim();
	return plain.length > 160 ? `${plain.slice(0, 160)}…` : plain;
}

function notJson(text: string, response: Response, request: FailedRequest): WordPressResponseError {
	const trimmed = text.trimStart();
	const jsonStart = trimmed.search(/[[{]/);
	let message: string;
	if (jsonStart > 0 && /(notice|warning|deprecated|error)/i.test(trimmed.slice(0, jsonStart))) {
		message = `PHP printed output before the JSON response, usually a notice from a plugin or theme: ${excerpt(trimmed.slice(0, jsonStart))}`;
	} else if (trimmed.startsWith('<')) {
		message = `Expected JSON but got an HTML page (HTTP ${response.status}). The URL may not be a WordPress REST API root, or a security plugin or firewall is blocking it: ${excerpt(trimmed)}`;
	} else {
		message = `Expected JSON but got: ${excerpt(trimmed)}`;
	}
	return new WordPressResponseError(message, response.status, text, request);
}

async function read<T>(response: Response, request: FailedRequest): Promise<Incoming<T>> {
	const { status, headers } = response;
	const type = headers.get('content-type') ?? '';
	// Exports and other files come back as they are.
	if (response.ok && type && !/json|^text\//i.test(type)) {
		return { data: (await response.blob()) as T, status, headers };
	}

	const text = await response.text();
	if (!text.trim()) {
		if (response.ok) return { data: null as T, status, headers };
		throw new WordPressResponseError(`HTTP ${status} with an empty body`, status, text, request);
	}

	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw notJson(text, response, request);
	}
	if (!response.ok) {
		if (isErrorBody(data)) throw new WordPressError(data, status, request);
		throw new WordPressResponseError(`HTTP ${status}: ${excerpt(text)}`, status, text, request);
	}
	return { data: data as T, status, headers };
}

export class Transport {
	constructor(readonly config: TransportConfig) {}

	url(path: string, query?: Record<string, unknown>): string {
		return routeUrl(this.config.root, path, query ? toQuery(query) : '');
	}

	async send<T = unknown>(outgoing: Outgoing): Promise<Incoming<T>> {
		const url = this.url(outgoing.path, outgoing.query);
		const request = { method: outgoing.method, url };
		const retries = outgoing.method === 'GET' ? this.config.retries : 0;

		for (let attempt = 0; ; attempt++) {
			const timeout = AbortSignal.timeout(outgoing.timeout ?? this.config.timeout);
			const signal = outgoing.signal ? AbortSignal.any([outgoing.signal, timeout]) : timeout;
			let response: Response;
			try {
				response = await this.fetch(outgoing, url, signal);
			} catch (error) {
				if (timeout.aborted) {
					throw new WordPressRequestError(`Timed out after ${outgoing.timeout ?? this.config.timeout} ms`, request, {
						cause: error,
						timedOut: true,
					});
				}
				if (outgoing.signal?.aborted) throw outgoing.signal.reason;
				if (attempt < retries) {
					await sleep(retryDelay(null, attempt) ?? 0, outgoing.signal);
					continue;
				}
				const reason = error instanceof Error ? error.message : String(error);
				throw new WordPressRequestError(`Request failed: ${reason}`, request, { cause: error });
			}

			if (response.redirected && outgoing.method !== 'GET') {
				await response.body?.cancel();
				throw new WordPressRequestError(
					`The site redirected the ${outgoing.method} to ${response.url}, which turns it into a GET, so nothing was changed. Use the final URL (often https:// or www.) as the client's url.`,
					request,
				);
			}

			if (attempt < retries && RETRY_STATUSES.has(response.status)) {
				const wait = retryDelay(response.headers.get('retry-after'), attempt);
				if (wait !== null) {
					await response.body?.cancel();
					await sleep(wait, outgoing.signal);
					continue;
				}
			}
			return read<T>(response, request);
		}
	}

	private async fetch(outgoing: Outgoing, url: string, signal: AbortSignal): Promise<Response> {
		const headers = new Headers(this.config.headers);
		for (const [name, value] of new Headers(outgoing.headers)) headers.set(name, value);
		if (!headers.has('accept')) headers.set('accept', 'application/json, */*;q=0.5');

		let method: string = outgoing.method;
		if (this.config.methodOverride && method !== 'GET' && method !== 'POST') {
			headers.set('x-http-method-override', method);
			method = 'POST';
		}

		let body = outgoing.body;
		if (outgoing.json !== undefined) {
			headers.set('content-type', 'application/json');
			body = JSON.stringify(outgoing.json);
		}

		const init: RequestInit = { method, headers, body, signal, redirect: 'follow' };
		await authorize(this.config.auth, { method, url, headers }, init);
		return this.config.fetch(url, init);
	}
}
