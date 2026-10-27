import { describe, expect, it } from 'vitest';
import { WordPressBatchValidationError } from '../../src/batch.js';
import { createClient } from '../../src/client.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

describe('batch', () => {
	it('sends prepared requests to /batch/v1 and pairs up the results', async () => {
		const { fetch, requests } = fakeFetch(() =>
			json(
				{
					responses: [
						{ body: { id: 5, title: { raw: 'One' } }, status: 201, headers: {} },
						{
							body: { code: 'rest_post_invalid_id', message: 'Invalid post ID.', data: { status: 404 } },
							status: 404,
							headers: {},
						},
					],
				},
				{ status: 207 },
			),
		);
		const wp = createClient({ url: 'https://example.com', fetch });
		const [created, missing] = await wp.batch([
			wp.prepare('POST /wp/v2/posts', { title: 'One', _fields: ['id', 'title'] }),
			wp.prepare('DELETE /wp/v2/posts/{id}', { id: 404, force: true }),
		]);

		expect(await requests[0]?.json()).toEqual({
			validation: 'normal',
			requests: [
				{ method: 'POST', path: '/wp/v2/posts?_fields=id,title', body: { title: 'One' } },
				{ method: 'DELETE', path: '/wp/v2/posts/404?force=true' },
			],
		});
		expect(created).toMatchObject({ ok: true, status: 201, data: { id: 5 } });
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(missing.error).toMatchObject({ code: 'rest_post_invalid_id', status: 404 });
			expect(missing.error.request.url).toBe('https://example.com/wp-json/wp/v2/posts/404?force=true');
		}
	});

	it('throws when require-all-validate stops the batch', async () => {
		const { fetch } = fakeFetch(() =>
			json({
				failed: 'validation',
				responses: [
					null,
					{ body: { code: 'rest_invalid_param', message: 'Invalid parameter(s): status' }, status: 400 },
				],
			}),
		);
		const wp = createClient({ url: 'https://example.com', fetch });
		const error = await wp
			.batch([wp.prepare('POST /wp/v2/posts', { title: 'a' }), wp.prepare('POST /wp/v2/posts', { title: 'b' })], {
				validation: 'require-all-validate',
			})
			.catch((e) => e);
		expect(error).toBeInstanceOf(WordPressBatchValidationError);
		expect(error.message).toBe('1 of 2 batch requests failed validation, so none were run');
		expect(error.errors[0]).toBeNull();
		expect(error.errors[1]).toMatchObject({ code: 'rest_invalid_param' });
	});

	it('splits batches larger than WordPress accepts', async () => {
		const { fetch, requests } = fakeFetch(async (request) => {
			const body = (await request.json()) as { requests: unknown[] };
			return json({ responses: body.requests.map(() => ({ body: {}, status: 200 })) });
		});
		const wp = createClient({ url: 'https://example.com', fetch });
		const results = await wp.batch(
			Array.from({ length: 30 }, (_, i) => wp.prepare('POST /wp/v2/tags', { name: `t${i}` })),
		);
		expect(results).toHaveLength(30);
		expect(requests).toHaveLength(2);
	});
});
