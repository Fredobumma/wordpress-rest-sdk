import { describe, expect, it } from 'vitest';
import { authorizationUrl, parseAuthorization } from '../../src/auth.js';
import { createClient } from '../../src/client.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

describe('auth', () => {
	it('sends application passwords with Basic auth, UTF-8 safe', async () => {
		const { fetch, requests } = fakeFetch(() => json({}));
		await createClient({ url: 'https://example.com', fetch, auth: { username: 'zoë', password: 'abcd efgh' } }).site();
		const header = requests[0]?.headers.get('authorization') ?? '';
		expect(header.startsWith('Basic ')).toBe(true);
		const decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
		expect(decoded).toBe('zoë:abcd efgh');
	});

	it('sends bearer tokens and nonces', async () => {
		const bearer = fakeFetch(() => json({}));
		await createClient({ url: 'https://example.com', fetch: bearer.fetch, auth: { token: 't0k3n' } }).site();
		expect(bearer.requests[0]?.headers.get('authorization')).toBe('Bearer t0k3n');

		const nonce = fakeFetch(() => json({}));
		await createClient({ url: 'https://example.com', fetch: nonce.fetch, auth: { nonce: 'abc123' } }).site();
		expect(nonce.requests[0]?.headers.get('x-wp-nonce')).toBe('abc123');
		expect(nonce.requests[0]?.credentials).toBe('include');
	});

	it('builds the approval URL and reads the callback', () => {
		const url = new URL(
			authorizationUrl('https://example.com/wp-admin/authorize-application.php', {
				appName: 'My App',
				appId: '1a2b',
				successUrl: 'https://app.example/done',
			}),
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			app_name: 'My App',
			app_id: '1a2b',
			success_url: 'https://app.example/done',
		});

		expect(
			parseAuthorization(
				'https://app.example/done?site_url=https%3A%2F%2Fexample.com&user_login=ada&password=abcd+efgh',
			),
		).toEqual({ approved: true, siteUrl: 'https://example.com', username: 'ada', password: 'abcd efgh' });
		expect(parseAuthorization('https://app.example/done?success=false')).toEqual({ approved: false });
	});
});
