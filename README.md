# wordpress-rest-sdk

A TypeScript SDK for the WordPress REST API. Its types come from WordPress itself, so they cover every core route, plus your own custom post types, fields and plugin routes.

```ts
import { createClient } from 'wordpress-rest-sdk';

const wp = createClient({ url: 'https://example.com' });

const posts = await wp.posts.list({ per_page: 5, _fields: ['id', 'title.rendered', 'link'] });
//    ^? { id: number; title: { rendered: string }; link: string }[]
```

- **Typed from the source.** WordPress describes every route with JSON Schema. The types are generated from those schemas: 257 routes in WordPress 7.1, each with its parameters, its response, and docs from the schema's descriptions.
- **Types that follow your request.** `context: 'edit'` adds raw fields, `_fields` narrows the response to what you asked for, and `force: true` on a delete changes what comes back. A misspelled parameter, a wrong type or a missing id is a compile error.
- **Your site, not just core.** `npx wordpress-rest-sdk generate --url https://your-site` writes types for every route on your site, including custom post types, registered meta and plugin endpoints.
- **The whole API.** Pagination with totals, `/batch/v1`, media uploads, application passwords, including the authorization flow, revisions, autosaves and abilities.
- **Runs anywhere `fetch` does.** Node 22+, browsers, Deno, Bun, Cloudflare Workers. No dependencies.

It is meant as a successor to [node-wpapi](https://github.com/WP-API/node-wpapi). The WordPress handbook still recommends it, but it hasn't had a release since 2021 and has no types.

## Install

```sh
npm install wordpress-rest-sdk
```

## Reading

```ts
const wp = createClient({ url: 'https://example.com' });

const page = await wp.pages.get(42);
const recent = await wp.posts.list({ categories: [3], orderby: 'date', per_page: 10 });
const found = await wp.search.list({ search: 'block themes', type: 'post' });

// Embed linked resources, such as the author or featured image.
const [post] = await wp.posts.list({ per_page: 1, _embed: ['author'] });
post._embedded?.author?.[0];
```

Collections have `list`, `get`, `create`, `update` and `delete`. They also have `page`, `paginate` and `all` (see [Pagination](#pagination)). Revisions and autosaves hang off the post: `wp.posts.revisions(postId).list()`.

These are all available: `posts`, `pages`, `media`, `comments`, `categories`, `tags`, `users`, `blocks`, `templates`, `templateParts`, `navigation`, `menus`, `menuItems`, `menuLocations`, `widgets`, `sidebars`, `plugins`, `themes`, `fontFamilies`, `types`, `statuses`, `taxonomies`, `blockTypes`, `search`, `settings` and `abilities`.

Any route can also be called by name, with path parameters taken from the parameters:

```ts
const revision = await wp.request('GET /wp/v2/posts/{parent}/revisions/{id}', { parent: 7, id: 31 });
```

## Writing

Writes need [authentication](#authentication).

```ts
const wp = createClient({
  url: 'https://example.com',
  auth: { username: 'editor', password: process.env.WP_APP_PASSWORD },
});

const draft = await wp.posts.create({ title: 'Hello', content: '<p>Hi</p>', status: 'draft' });
await wp.posts.update(draft.id, { status: 'publish' });

const trashed = await wp.posts.delete(draft.id); // moved to the trash: a post
const gone = await wp.posts.delete(draft.id, { force: true }); // { deleted: true, previous: post }
```

Users can't be trashed, so WordPress requires `force` and `reassign`. The types know that: `wp.users.delete(5)` doesn't compile.

## Your site's types

Core types ship with the package. To get types for your own site, generate a route map from it. The map covers custom post types and taxonomies, fields registered with `register_meta` or `register_rest_field`, and plugin routes.

```sh
npx wordpress-rest-sdk generate --url https://example.com --out src/wordpress.ts
```

```ts
import type { Routes } from './wordpress.js';

const wp = createClient<Routes>({ url: 'https://example.com' });

const books = await wp.collection('/wp/v2/books').list({ genres: [4], _fields: ['id', 'meta.isbn'] });
//    ^? { id: number; meta: { isbn: string } }[]
```

To include routes only signed-in users can see, pass `--username` and `--password`, or set `WORDPRESS_USERNAME` and `WORDPRESS_PASSWORD`. Run `npx wordpress-rest-sdk --help` for the other options.

## Pagination

```ts
const first = await wp.posts.page({ per_page: 20 });
first.total; // X-WP-Total
first.totalPages; // X-WP-TotalPages
const second = await first.next();

// Every item, fetched 100 at a time as you go:
for await (const post of wp.posts.paginate({ status: 'publish' })) {
  console.log(post.title.rendered);
}

// Or all at once:
const categories = await wp.categories.all();
```

## Batch requests

`/batch/v1` runs up to 25 writes in one HTTP request; longer lists are split. Each result has the type of its own request:

```ts
const [created, removed] = await wp.batch([
  wp.prepare('POST /wp/v2/posts', { title: 'One' }),
  wp.prepare('DELETE /wp/v2/posts/{id}', { id: 9, force: true }),
]);

if (created.ok) created.data.id;
else created.error.code;
```

With `{ validation: 'require-all-validate' }`, WordPress checks every request before running any of them. If one is invalid, nothing runs and the call throws `WordPressBatchValidationError`. Only routes that WordPress allows in batches compile.

## Media

```ts
const image = await wp.media.upload(
  { file: await readFile('cover.jpg'), filename: 'cover.jpg', type: 'image/jpeg' },
  { alt_text: 'The cover', post: 42 },
);
```

`file` can be a `Blob`, a `File`, an `ArrayBuffer` or a `Uint8Array`.

## Authentication

```ts
// Application passwords: built into WordPress, from Users → Profile.
createClient({ url, auth: { username: 'editor', password: 'abcd efgh ijkl mnop qrst uvwx' } });

// Cookie authentication, for code running inside wp-admin or a theme.
createClient({ url, auth: { nonce: wpApiSettings.nonce } });

// Bearer tokens, from JWT or OAuth plugins.
createClient({ url, auth: { token } });

// Anything else.
createClient({ url, auth: ({ headers }) => headers.set('x-api-key', key) });
```

An app can ask users to approve an application password, rather than have them paste one in:

```ts
import { authorizationUrl, parseAuthorization } from 'wordpress-rest-sdk';

const endpoint = await wp.authorizationEndpoint(); // null if the site turned them off
if (endpoint) redirect(authorizationUrl(endpoint, { appName: 'My App', successUrl: 'https://my.app/connected' }));

// On https://my.app/connected:
const result = parseAuthorization(request.url);
if (result.approved) save(result.siteUrl, result.username, result.password);
```

## Errors

```ts
import { isWordPressError } from 'wordpress-rest-sdk';

try {
  await wp.posts.get(123);
} catch (error) {
  if (isWordPressError(error, 'rest_post_invalid_id')) {
    error.status; // 404
  }
}
```

There are three error classes:

- `WordPressError`: WordPress answered with an error. It has `code`, `status` and `data`; for invalid parameters, `params` gives a message for each one.
- `WordPressResponseError`: the response wasn't WordPress JSON. The message says what came instead, such as a security plugin's HTML page or PHP notices printed before the JSON.
- `WordPressRequestError`: the request didn't complete. `timedOut` tells a timeout apart from a network failure.

## Options

```ts
createClient({
  url: 'https://example.com', // or the API root: https://example.com/wp-json
  auth,
  timeout: 30_000, // per request, in ms
  retries: 2, // retries a GET after network errors, rate limits and server errors, honouring Retry-After
  methodOverride: false, // send PUT/PATCH/DELETE as POST, for hosts that block them
  headers: { 'user-agent': 'my-app' },
  fetch, // your own fetch, for proxies, logging or tests
});
```

Sites without pretty permalinks work too: pass `https://example.com/?rest_route=/`. If a site moved its API somewhere else, `discover()` finds it:

```ts
const root = await discover('https://example.com');
const wp = createClient({ root });
```

For anything else, `wp.raw(method, path, { query, json, body })` sends an untyped request and returns its data, status and headers.

## Development

```sh
pnpm install
pnpm check            # types, lint, unit and integration tests
pnpm wp               # a test WordPress on http://127.0.0.1:9400
pnpm generate:core    # regenerate src/generated/core.ts from a stock WordPress
```

The integration tests run against real WordPress. [WordPress Playground](https://wordpress.org/playground/) runs it in Node, so the tests need no Docker, PHP or database.

The site from `pnpm wp` has two users: `admin` (password `password`) and `author` (password `author-pass`). Their application passwords, which work for API requests but not on the login page, are written to `.wp-credentials.json`.

## License

MIT
