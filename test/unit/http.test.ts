import { describe, expect, it } from 'vitest';
import { createClient } from '../../src/client.js';
import { WordPressError, WordPressRequestError, WordPressResponseError } from '../../src/errors.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

const url = 'https://example.com';

describe('requests', () => {
	it('puts GET and DELETE parameters in the query, and writes in a JSON body', async () => {
		const { fetch, requests } = fakeFetch(() => json({ id: 1 }));
		const wp = createClient({ url, fetch });
		await wp.posts.list({ per_page: 5, _fields: ['id', 'title'] });
		await wp.posts.delete(7, { force: true });
		await wp.posts.update(7, { title: 'Hi', _fields: ['id'] });

		expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
			'GET https://example.com/wp-json/wp/v2/posts?per_page=5&_fields=id,title',
			'DELETE https://example.com/wp-json/wp/v2/posts/7?force=true',
			'POST https://example.com/wp-json/wp/v2/posts/7?_fields=id',
		]);
		expect(requests[2]?.headers.get('content-type')).toBe('application/json');
		expect(await requests[2]?.json()).toEqual({ title: 'Hi' });
	});

	it('sends PUT, PATCH and DELETE as POST when methodOverride is on', async () => {
		const { fetch, requests } = fakeFetch(() => json({ deleted: true }));
		await createClient({ url, fetch, methodOverride: true }).posts.delete(7, { force: true });
		expect(requests[0]?.method).toBe('POST');
		expect(requests[0]?.headers.get('x-http-method-override')).toBe('DELETE');
	});

	it('turns WordPress errors into WordPressError', async () => {
		const { fetch } = fakeFetch(() =>
			json(
				{
					code: 'rest_invalid_param',
					message: 'Invalid parameter(s): per_page',
					data: { status: 400, params: { per_page: 'per_page must be between 1 (inclusive) and 100 (inclusive)' } },
				},
				{ status: 400 },
			),
		);
		const error = await createClient({ url, fetch })
			.request('GET /wp/v2/posts', { per_page: 500 })
			.catch((e) => e);
		expect(error).toBeInstanceOf(WordPressError);
		expect(error).toMatchObject({ code: 'rest_invalid_param', status: 400, message: 'Invalid parameter(s): per_page' });
		expect(error.params).toEqual({ per_page: 'per_page must be between 1 (inclusive) and 100 (inclusive)' });
		expect(error.request).toEqual({ method: 'GET', url: 'https://example.com/wp-json/wp/v2/posts?per_page=500' });
	});

	it('explains PHP output printed before the JSON', async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response(
					'<br />\n<b>Deprecated</b>: Creation of dynamic property in /plugin.php on line 3<br />\n{"id":1}',
					{ headers: { 'content-type': 'application/json' } },
				),
		);
		const error = await createClient({ url, fetch })
			.posts.get(1)
			.catch((e) => e);
		expect(error).toBeInstanceOf(WordPressResponseError);
		expect(error.message).toMatch(
			/^PHP printed output before the JSON response.*Deprecated: Creation of dynamic property/,
		);
	});

	it('explains an HTML page where JSON was expected', async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response('<!doctype html><title>Blocked</title>', {
					status: 403,
					headers: { 'content-type': 'text/html' },
				}),
		);
		const error = await createClient({ url, fetch })
			.posts.list()
			.catch((e) => e);
		expect(error).toBeInstanceOf(WordPressResponseError);
		expect(error.message).toMatch(/^Expected JSON but got an HTML page \(HTTP 403\)/);
	});

	it('returns files as Blobs', async () => {
		const { fetch } = fakeFetch(
			() => new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'content-type': 'application/zip' } }),
		);
		const zip = await createClient({ url, fetch }).request('GET /wp-block-editor/v1/export');
		expect(zip).toBeInstanceOf(Blob);
		expect(zip.size).toBe(4);
	});

	it('retries a GET after a 503, honouring Retry-After', async () => {
		const { fetch, requests } = fakeFetch((_, attempt) =>
			attempt === 1 ? new Response('busy', { status: 503, headers: { 'retry-after': '0' } }) : json([{ id: 1 }]),
		);
		expect(await createClient({ url, fetch }).posts.list()).toEqual([{ id: 1 }]);
		expect(requests).toHaveLength(2);
	});

	it("doesn't retry writes", async () => {
		const { fetch, requests } = fakeFetch(() =>
			json({ code: 'oops', message: 'Down' }, { status: 503, headers: { 'retry-after': '0' } }),
		);
		await expect(createClient({ url, fetch }).posts.create({ title: 'x' })).rejects.toThrow('Down');
		expect(requests).toHaveLength(1);
	});

	it('times out', async () => {
		const { fetch } = fakeFetch(
			(request) =>
				new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))),
		);
		const error = await createClient({ url, fetch, timeout: 20, retries: 0 })
			.posts.list()
			.catch((e) => e);
		expect(error).toBeInstanceOf(WordPressRequestError);
		expect(error).toMatchObject({ timedOut: true, message: 'Timed out after 20 ms' });
	});

	it('refuses a write that a redirect turned into a GET', async () => {
		const { fetch } = fakeFetch(() => {
			const response = json([]);
			Object.defineProperty(response, 'redirected', { value: true });
			Object.defineProperty(response, 'url', { value: 'https://www.example.com/wp-json/wp/v2/posts' });
			return response;
		});
		await expect(createClient({ url, fetch }).posts.create({ title: 'x' })).rejects.toThrow(
			'The site redirected the POST to https://www.example.com/wp-json/wp/v2/posts',
		);
	});
});

describe('pagination', () => {
	const pages = (perPage: number, total: number) =>
		fakeFetch((request) => {
			const page = Number(new URL(request.url).searchParams.get('page'));
			const start = (page - 1) * perPage;
			const items = Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) => ({
				id: start + i + 1,
			}));
			return json(items, {
				headers: { 'x-wp-total': String(total), 'x-wp-totalpages': String(Math.ceil(total / perPage)) },
			});
		});

	it('reads totals and links pages', async () => {
		const { fetch } = pages(10, 23);
		const first = await createClient({ url, fetch }).posts.page({ per_page: 10 });
		expect(first).toMatchObject({ page: 1, perPage: 10, total: 23, totalPages: 3, hasNextPage: true });
		const third = await (await first.next())?.next();
		expect(third?.items.map((post) => post.id)).toEqual([21, 22, 23]);
		expect(third?.hasNextPage).toBe(false);
		expect(await third?.next()).toBeNull();
	});

	it('walks every page, 100 at a time unless told otherwise', async () => {
		const { fetch, requests } = pages(100, 230);
		const ids = (await createClient({ url, fetch }).posts.all()).map((post) => post.id);
		expect(ids).toHaveLength(230);
		expect(requests.map((request) => new URL(request.url).search)).toEqual([
			'?per_page=100&page=1',
			'?per_page=100&page=2',
			'?per_page=100&page=3',
		]);
	});

	it("doesn't fetch until iteration starts", async () => {
		const { fetch, requests } = pages(100, 5);
		const iterator = createClient({ url, fetch }).posts.paginate();
		expect(requests).toHaveLength(0);
		await iterator.next();
		expect(requests).toHaveLength(1);
	});
});
