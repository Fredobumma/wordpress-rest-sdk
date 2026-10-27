/**
 * Compile-time tests: `pnpm typecheck` fails if an assertion here stops
 * holding, or if a line marked `@ts-expect-error` starts compiling.
 */

import {
	type Category,
	createClient,
	type Deleted,
	type Link,
	type ListPage,
	type Post,
	type PostEdit,
	type UserEdit,
} from '../../src/index.js';
import type { SiteRoutes } from '../generated/site.js';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
function expect<T extends true>(): T | undefined {
	return undefined;
}
type Linked<T> = T & { _links?: Record<string, Link[]> };

const wp = createClient({ url: 'https://example.com' });

// Reads default to the `view` context.
const posts = await wp.posts.list({ per_page: 5, categories: [1, 2], status: ['publish'] });
expect<Same<typeof posts, Array<Linked<Post>>>>();

// `context: 'edit'` returns raw fields.
const editable = await wp.posts.get(1, { context: 'edit' });
expect<Same<(typeof editable)['content'], PostEdit['content']>>();

// `_fields` narrows the response, nested paths included.
const slim = await wp.posts.list({ _fields: ['id', 'title.rendered', 'link'] });
expect<Same<(typeof slim)[number], { id: number; title: { rendered: string }; link: string }>>();

// Writes answer in the `edit` context.
const created = await wp.posts.create({ title: 'Hello', content: 'Body', status: 'draft' });
expect<Same<typeof created, Linked<PostEdit>>>();

// Deleting: trash by default, gone for good with `force`.
const trashed = await wp.posts.delete(1);
expect<Same<typeof trashed, Linked<PostEdit> | Deleted<Linked<PostEdit>>>>();
const gone = await wp.posts.delete(1, { force: true });
expect<Same<typeof gone, Deleted<Linked<PostEdit>>>>();

// Users can't be trashed, so WordPress requires `force` and `reassign`.
const removed = await wp.users.delete(2, { force: true, reassign: 1 });
expect<Same<typeof removed, Deleted<Linked<UserEdit>>>>();
// @ts-expect-error reassign and force are required
await wp.users.delete(2);

// Mistakes are compile errors.
// @ts-expect-error unknown parameter
await wp.posts.list({ per_pgae: 5 });
// @ts-expect-error per_page is a number
await wp.posts.list({ per_page: '5' });
// @ts-expect-error not a post field
await wp.posts.list({ _fields: ['nope'] });
// @ts-expect-error not a route
await wp.request('GET /wp/v2/postz');
// @ts-expect-error the id is required
await wp.request('GET /wp/v2/posts/{id}');

// Any route by name.
const category = await wp.request('GET /wp/v2/categories/{id}', { id: 3 });
expect<Same<typeof category, Linked<Category>>>();
const types = await wp.types.list();
expect<Same<keyof typeof types, string>>();
const zip = await wp.request('GET /wp-block-editor/v1/export');
expect<Same<typeof zip, Blob>>();

// Pagination keeps the item type.
const first = await wp.page('GET /wp/v2/posts', { per_page: 20, _fields: ['id'] });
expect<Same<typeof first, ListPage<{ id: number }>>>();
for await (const post of wp.posts.paginate({ _fields: ['id', 'slug'] })) {
	expect<Same<typeof post, { id: number; slug: string }>>();
}

// Revisions of one post.
const revisions = await wp.posts.revisions(1).list({ _fields: ['id', 'parent'] });
expect<Same<typeof revisions, Array<{ id: number; parent: number }>>>();

// Batches type each result from its request.
const [made, deleted] = await wp.batch([
	wp.prepare('POST /wp/v2/posts', { title: 'One' }),
	wp.prepare('DELETE /wp/v2/posts/{id}', { id: 9, force: true }),
]);
if (made.ok) expect<Same<typeof made.data, Linked<PostEdit>>>();
if (deleted.ok) expect<Same<typeof deleted.data, Deleted<Linked<PostEdit>>>>();
// @ts-expect-error GET requests can't be batched
await wp.batch([wp.prepare('GET /wp/v2/posts')]);
// @ts-expect-error settings aren't batchable
await wp.batch([wp.prepare('POST /wp/v2/settings', { title: 'x' })]);

// A site's own types: custom post types, taxonomies and registered meta.
const site = createClient<SiteRoutes>({ url: 'https://example.com' });
const books = await site.collection('/wp/v2/books').list({ genres: [1], _fields: ['id', 'meta.isbn'] });
expect<Same<(typeof books)[number], { id: number; meta: { isbn: string } }>>();
const book = await site.request('POST /wp/v2/books', {
	title: 'Dune',
	meta: { isbn: '978-0441013593', page_count: 412 },
});
expect<Same<(typeof book)['meta']['page_count'], number>>();
// @ts-expect-error page_count is a number
await site.request('POST /wp/v2/books', { meta: { page_count: '412' } });
