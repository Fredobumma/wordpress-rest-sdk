import { describe, expect, it } from 'vitest';
import { apiRoot, fillPath, routeUrl } from '../../src/url.js';

describe('apiRoot', () => {
	it('adds /wp-json to a site address', () => {
		expect(apiRoot('https://example.com')).toEqual({ base: 'https://example.com/wp-json', style: 'path' });
		expect(apiRoot('https://example.com/blog/')).toEqual({ base: 'https://example.com/blog/wp-json', style: 'path' });
	});

	it('keeps a root that is already given', () => {
		expect(apiRoot('https://example.com/wp-json/')).toEqual({ base: 'https://example.com/wp-json', style: 'path' });
		expect(apiRoot('https://example.com/api/', { exact: true })).toEqual({
			base: 'https://example.com/api',
			style: 'path',
		});
	});

	it('uses ?rest_route= for sites without pretty permalinks', () => {
		const root = apiRoot('https://example.com/index.php?rest_route=/');
		expect(root).toEqual({ base: 'https://example.com/index.php', style: 'query' });
		expect(routeUrl(root, '/wp/v2/posts', 'per_page=5')).toBe(
			'https://example.com/index.php?rest_route=/wp/v2/posts&per_page=5',
		);
	});
});

describe('fillPath', () => {
	it('fills placeholders and returns the remaining parameters', () => {
		expect(fillPath('/wp/v2/posts/{parent}/revisions/{id}', { parent: 4, id: 9, context: 'edit' })).toEqual({
			path: '/wp/v2/posts/4/revisions/9',
			rest: { context: 'edit' },
		});
	});

	it('keeps slashes in plugin files and template ids', () => {
		expect(fillPath('/wp/v2/plugins/{plugin}', { plugin: 'akismet/akismet' }).path).toBe(
			'/wp/v2/plugins/akismet/akismet',
		);
		expect(fillPath('/wp/v2/templates/{id}', { id: 'twentytwentyfive//home' }).path).toBe(
			'/wp/v2/templates/twentytwentyfive//home',
		);
		expect(fillPath('/wp/v2/tags/{id}', { id: 'a b?' }).path).toBe('/wp/v2/tags/a%20b%3F');
	});

	it('throws when a path parameter is missing', () => {
		expect(() => fillPath('/wp/v2/posts/{id}', {})).toThrow('Missing the "id" path parameter');
	});
});
