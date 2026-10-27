import { describe, expect, it } from 'vitest';
import { discover, rootFromHtml, rootFromLinkHeader } from '../../src/discover.js';
import { fakeFetch } from '../support/fake-fetch.js';

describe('discover', () => {
	it('reads the root from the Link header among other links', () => {
		expect(
			rootFromLinkHeader(
				'<https://example.com/wp-json/wp/v2/pages/2>; rel="alternate"; type="application/json", <https://example.com/wp-json/>; rel="https://api.w.org/", <https://example.com/?p=2>; rel=shortlink',
			),
		).toBe('https://example.com/wp-json/');
	});

	it('reads the root from the HTML head', () => {
		expect(
			rootFromHtml(`<head><link rel='https://api.w.org/' href='https://example.com/?rest_route=/&amp;x=1' /></head>`),
		).toBe('https://example.com/?rest_route=/&x=1');
	});

	it('falls back from headers to HTML, and fails clearly', async () => {
		const html = fakeFetch(() => new Response('<link rel="https://api.w.org/" href="/wp-json/">'));
		expect(await discover('https://example.com/blog/', { fetch: html.fetch })).toBe('https://example.com/wp-json/');

		const none = fakeFetch(() => new Response('<html></html>'));
		await expect(discover('https://example.com', { fetch: none.fetch })).rejects.toThrow(
			"doesn't advertise a WordPress REST API",
		);
	});
});
