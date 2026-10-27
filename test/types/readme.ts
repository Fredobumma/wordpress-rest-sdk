/**
 * The README's examples, so they keep compiling. Things the examples leave
 * to the reader are declared.
 */

import {
	authorizationUrl,
	type CoreRoutes,
	createClient,
	discover,
	isWordPressError,
	parseAuthorization,
	type WordPressClient,
} from '../../src/index.js';
import type { SiteRoutes } from '../generated/site.js';

declare const url: string;
declare const token: string;
declare const key: string;
declare const wpApiSettings: { nonce: string };
declare const request: Request;
declare function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
declare function redirect(to: string): void;
declare function save(site: string, username: string, password: string): void;

export async function reading(wp: WordPressClient<CoreRoutes>) {
	const posts = await wp.posts.list({ per_page: 5, _fields: ['id', 'title.rendered', 'link'] });
	posts satisfies Array<{ id: number; title: { rendered: string }; link: string }>;

	await wp.pages.get(42);
	await wp.posts.list({ categories: [3], orderby: 'date', per_page: 10 });
	await wp.search.list({ search: 'block themes', type: 'post' });
	const [post] = await wp.posts.list({ per_page: 1, _embed: ['author'] });
	post?._embedded?.author?.[0];
	await wp.posts.revisions(7).list();
	await wp.request('GET /wp/v2/posts/{parent}/revisions/{id}', { parent: 7, id: 31 });
}

export async function writing() {
	const wp = createClient({
		url: 'https://example.com',
		auth: { username: 'editor', password: String(process.env.WP_APP_PASSWORD) },
	});
	const draft = await wp.posts.create({ title: 'Hello', content: '<p>Hi</p>', status: 'draft' });
	await wp.posts.update(draft.id, { status: 'publish' });
	await wp.posts.delete(draft.id);
	const gone = await wp.posts.delete(draft.id, { force: true });
	gone.deleted satisfies true;
}

export async function siteTypes() {
	const wp = createClient<SiteRoutes>({ url: 'https://example.com' });
	const books = await wp.collection('/wp/v2/books').list({ genres: [4], _fields: ['id', 'meta.isbn'] });
	books satisfies Array<{ id: number; meta: { isbn: string } }>;
}

export async function pagination(wp: WordPressClient<CoreRoutes>) {
	const first = await wp.posts.page({ per_page: 20 });
	first.total satisfies number | null;
	await first.next();
	for await (const post of wp.posts.paginate({ status: 'publish' })) post.title.rendered satisfies string;
	await wp.categories.all();
}

export async function batching(wp: WordPressClient<CoreRoutes>) {
	const [created, removed] = await wp.batch([
		wp.prepare('POST /wp/v2/posts', { title: 'One' }),
		wp.prepare('DELETE /wp/v2/posts/{id}', { id: 9, force: true }),
	]);
	if (created.ok) created.data.id satisfies number;
	else created.error.code satisfies string;
	return removed;
}

export async function media(wp: WordPressClient<CoreRoutes>) {
	await wp.media.upload(
		{ file: await readFile('cover.jpg'), filename: 'cover.jpg', type: 'image/jpeg' },
		{ alt_text: 'The cover', post: 42 },
	);
}

export async function authentication(wp: WordPressClient<CoreRoutes>) {
	createClient({ url, auth: { username: 'editor', password: 'abcd efgh ijkl mnop qrst uvwx' } });
	createClient({ url, auth: { nonce: wpApiSettings.nonce } });
	createClient({ url, auth: { token } });
	createClient({ url, auth: ({ headers }) => headers.set('x-api-key', key) });

	const endpoint = await wp.authorizationEndpoint();
	if (endpoint) redirect(authorizationUrl(endpoint, { appName: 'My App', successUrl: 'https://my.app/connected' }));
	const result = parseAuthorization(request.url);
	if (result.approved) save(result.siteUrl, result.username, result.password);
}

export async function errors(wp: WordPressClient<CoreRoutes>) {
	try {
		await wp.posts.get(123);
	} catch (error) {
		if (isWordPressError(error, 'rest_post_invalid_id')) error.status satisfies number;
	}
}

export async function options() {
	createClient({
		url: 'https://example.com',
		timeout: 30_000,
		retries: 2,
		methodOverride: false,
		headers: { 'user-agent': 'my-app' },
		fetch,
	});
	createClient({ url: 'https://example.com/?rest_route=/' });
	const root = await discover('https://example.com');
	createClient({ root });
}
