import { describe, expect, inject, it } from 'vitest';
import { createClient, WordPressBatchValidationError } from '../../src/index.js';
import type { SiteRoutes } from '../generated/site.js';

const { url, admin, author } = inject('wordpress');
const wp = createClient<SiteRoutes>({ url, auth: admin });

describe('posts', () => {
	it('creates, edits, trashes and deletes a post', async () => {
		const post = await wp.posts.create({ title: 'Draft from the SDK', content: '<p>Hi</p>', status: 'draft' });
		expect(post).toMatchObject({ status: 'draft', title: { raw: 'Draft from the SDK' } });

		const updated = await wp.posts.update(post.id, { title: 'Renamed', status: 'publish' });
		expect(updated.title.raw).toBe('Renamed');
		expect((await wp.posts.get(post.id, { context: 'edit' })).content.raw).toBe('<p>Hi</p>');

		const trashed = await wp.posts.delete(post.id);
		expect(trashed).toMatchObject({ id: post.id, status: 'trash' });
		expect(await wp.posts.delete(post.id, { force: true })).toMatchObject({ deleted: true, previous: { id: post.id } });
	});

	it('keeps revisions', async () => {
		const post = await wp.posts.create({ title: 'Versioned', content: 'one', status: 'publish' });
		await wp.posts.update(post.id, { content: 'two' });
		const revisions = await wp.posts.revisions(post.id).list({ context: 'edit' });
		expect(revisions.map((revision) => revision.content.raw)).toContain('two');
		await wp.posts.delete(post.id, { force: true });
	});

	it('works through X-HTTP-Method-Override', async () => {
		const override = createClient({ url, auth: admin, methodOverride: true });
		const tag = await override.tags.create({ name: `override-${Date.now()}` });
		const patched = await override.request('PATCH /wp/v2/tags/{id}', { id: tag.id, description: 'patched' });
		expect(patched.description).toBe('patched');
		expect(await override.tags.delete(tag.id, { force: true })).toMatchObject({ deleted: true });
	});
});

describe('media', () => {
	it('uploads a file along with its fields', async () => {
		const png = Uint8Array.from(
			atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
			(c) => c.charCodeAt(0),
		);
		const media = await wp.media.upload(
			{ file: png, filename: 'pixel.png', type: 'image/png' },
			{ title: 'Pixel', alt_text: 'One pixel' },
		);
		expect(media).toMatchObject({
			media_type: 'image',
			mime_type: 'image/png',
			alt_text: 'One pixel',
			title: { raw: 'Pixel' },
		});
		expect(await wp.media.delete(media.id, { force: true })).toMatchObject({ deleted: true });
	});
});

describe('batch', () => {
	it('runs several writes in one request, each with its own result', async () => {
		const [a, b, invalid] = await wp.batch([
			wp.prepare('POST /wp/v2/posts', { title: 'Batch A' }),
			wp.prepare('POST /wp/v2/posts', { title: 'Batch B' }),
			wp.prepare('POST /wp/v2/posts', { title: 'Batch C', date: 'not a date' }),
		]);
		expect(a.ok && a.data.title.raw).toBe('Batch A');
		expect(b.ok && b.status).toBe(201);
		expect(!invalid.ok && invalid.error.code).toBe('rest_invalid_param');

		const ids = [a, b].flatMap((result) => (result.ok ? [result.data.id] : []));
		const deleted = await wp.batch(ids.map((id) => wp.prepare('DELETE /wp/v2/posts/{id}', { id, force: true })));
		expect(deleted.every((result) => result.ok)).toBe(true);
	});

	it('runs nothing when validation is required and one request is invalid', async () => {
		const title = `Atomic ${Date.now()}`;
		await expect(
			wp.batch([wp.prepare('POST /wp/v2/posts', { title }), wp.prepare('POST /wp/v2/posts', { title, date: 'nope' })], {
				validation: 'require-all-validate',
			}),
		).rejects.toBeInstanceOf(WordPressBatchValidationError);
		expect(await wp.posts.list({ search: title, status: ['draft', 'publish'] })).toEqual([]);
	});
});

describe('users', () => {
	it('knows who is signed in', async () => {
		expect(await wp.users.me({ context: 'edit' })).toMatchObject({ username: 'admin', roles: ['administrator'] });
	});

	it('enforces capabilities', async () => {
		const asAuthor = createClient({ url, auth: author });
		await expect(asAuthor.settings.get()).rejects.toMatchObject({ status: 403 });
	});

	it('issues, uses and revokes an application password', async () => {
		const passwords = wp.users.applicationPasswords('me');
		expect((await passwords.introspect()).name).toBe('wordpress-rest-sdk tests');

		const issued = await passwords.create({ name: 'temporary' });
		const temporary = createClient({ url, auth: { username: 'admin', password: String(issued.password) } });
		expect((await temporary.users.me()).id).toBe(1);

		await passwords.delete(issued.uuid);
		await expect(temporary.users.me()).rejects.toMatchObject({ status: 401 });
	});
});

describe('site settings', () => {
	it('updates and restores a setting', async () => {
		const before = await wp.settings.get();
		expect((await wp.settings.update({ description: 'Tested by wordpress-rest-sdk' })).description).toBe(
			'Tested by wordpress-rest-sdk',
		);
		await wp.settings.update({ description: before.description });
	});
});

describe('custom post types', () => {
	it('writes and filters books by genre, with registered meta', async () => {
		const genres = wp.collection('/wp/v2/genres');
		const books = wp.collection('/wp/v2/books');
		const genre = await genres.create({ name: `Science fiction ${Date.now()}` });
		const book = await books.create({
			title: 'Dune',
			status: 'publish',
			meta: { isbn: '978-0441013593', page_count: 412 },
			genres: [genre.id],
		});
		expect(book.meta).toMatchObject({ isbn: '978-0441013593', page_count: 412 });

		const found = await books.list({ genres: [genre.id], _fields: ['id', 'meta.isbn'] });
		expect(found).toEqual([{ id: book.id, meta: { isbn: '978-0441013593' } }]);

		await books.delete(book.id, { force: true });
		await genres.delete(genre.id, { force: true });
	});
});
