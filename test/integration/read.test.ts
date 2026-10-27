import { describe, expect, inject, it } from 'vitest';
import { createClient, discover, isWordPressError, WordPressError } from '../../src/index.js';
import type { SiteRoutes } from '../generated/site.js';

const { url, admin } = inject('wordpress');
const wp = createClient<SiteRoutes>({ url });
const signedIn = createClient<SiteRoutes>({ url, auth: admin });

describe('reading', () => {
	it('reads the site index', async () => {
		const index = await wp.site();
		expect(index.namespaces).toContain('wp/v2');
		expect(await wp.authorizationEndpoint()).toBe(`${url}/wp-admin/authorize-application.php`);
	});

	it('finds the API root from the home page', async () => {
		expect(await discover(url)).toBe(`${url}/wp-json/`);
	});

	it('lists posts in the view context', async () => {
		const posts = await wp.posts.list({ search: 'Seed post', per_page: 5, orderby: 'id', order: 'asc' });
		expect(posts.map((post) => post.title.rendered)).toEqual([
			'Seed post 1',
			'Seed post 2',
			'Seed post 3',
			'Seed post 4',
			'Seed post 5',
		]);
		expect(posts[0]?.content).not.toHaveProperty('raw');
	});

	it('returns only the fields asked for', async () => {
		const [post] = await wp.posts.list({ per_page: 1, _fields: ['id', 'title.rendered'] });
		expect(Object.keys(post ?? {}).sort()).toEqual(['id', 'title']);
		expect(Object.keys(post?.title ?? {})).toEqual(['rendered']);
	});

	it('embeds linked resources', async () => {
		const [post] = await wp.posts.list({ search: 'Seed post', per_page: 1, _embed: ['author'] });
		expect(post?._embedded?.author?.[0]).toMatchObject({ name: 'admin' });
	});

	it('pages through a collection', async () => {
		const first = await wp.posts.page({ search: 'Seed post', per_page: 10 });
		expect(first).toMatchObject({ total: 23, totalPages: 3, hasNextPage: true });
		expect((await first.next())?.items).toHaveLength(10);

		const all = await wp.posts.all({ search: 'Seed post', per_page: 7 });
		expect(new Set(all.map((post) => post.id)).size).toBe(23);

		let count = 0;
		for await (const post of wp.posts.paginate({ search: 'Seed post', _fields: ['id'] })) count += post.id > 0 ? 1 : 0;
		expect(count).toBe(23);
	});

	it('works on sites without pretty permalinks', async () => {
		const plain = createClient({ url: `${url}/?rest_route=/` });
		expect(plain.url('/wp/v2/posts')).toBe(`${url}/?rest_route=/wp/v2/posts`);
		expect(await plain.posts.list({ per_page: 2 })).toHaveLength(2);
	});

	it('reads collections keyed by slug', async () => {
		const types = await wp.types.list();
		expect(Object.keys(types)).toEqual(expect.arrayContaining(['post', 'page', 'book']));
		expect((await wp.types.get('book')).rest_base).toBe('books');
	});

	it('reads templates by their theme//slug ids', async () => {
		const [theme] = await signedIn.themes.list({ status: 'active' });
		const template = await signedIn.templates.get(`${theme?.stylesheet}//index`, { context: 'edit' });
		expect(template.id).toBe(`${theme?.stylesheet}//index`);
	});

	it('reads settings and block types when signed in', async () => {
		expect((await signedIn.settings.get()).title).toBe('My WordPress Website');
		expect((await signedIn.blockTypes.get('core/paragraph')).name).toBe('core/paragraph');
	});

	it('runs abilities with the method WordPress requires', async () => {
		const info = await signedIn.abilities.run('core/get-site-info', { fields: ['name', 'version'] });
		expect(info).toEqual({ name: 'My WordPress Website', version: expect.any(String) });
	});
});

describe('errors', () => {
	it('reports a missing item', async () => {
		const error = await wp.posts.get(999_999).catch((e: unknown) => e);
		expect(isWordPressError(error, 'rest_post_invalid_id')).toBe(true);
		expect(error).toMatchObject({ status: 404 });
	});

	it('reports which parameters are invalid', async () => {
		const error = await wp.posts.list({ per_page: 500 }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(WordPressError);
		expect((error as WordPressError).params.per_page).toMatch(/between 1/);
	});

	it('refuses the edit context to visitors', async () => {
		await expect(wp.posts.list({ context: 'edit' })).rejects.toMatchObject({
			code: 'rest_forbidden_context',
			status: 401,
		});
	});

	it('rejects a wrong application password', async () => {
		const wrong = createClient({ url, auth: { username: 'admin', password: 'abcd abcd abcd abcd abcd abcd' } });
		await expect(wrong.users.me()).rejects.toMatchObject({ status: 401 });
	});
});
