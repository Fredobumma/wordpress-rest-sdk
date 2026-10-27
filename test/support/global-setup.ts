import type { TestProject } from 'vitest/node';
import { type Credentials, startTestSite } from './site.js';

declare module 'vitest' {
	export interface ProvidedContext {
		wordpress: { url: string; admin: Credentials; author: Credentials };
	}
}

/**
 * Boots the test site once for the integration project. Set WORDPRESS_URL
 * and WORDPRESS_CREDENTIALS (the path to a credentials.json) to reuse one
 * started with `pnpm wp` instead.
 */
export default async function setup(project: TestProject) {
	const { WORDPRESS_URL: url, WORDPRESS_CREDENTIALS: credentials } = process.env;
	if (url && credentials) {
		const { readFile } = await import('node:fs/promises');
		project.provide('wordpress', { url, ...JSON.parse(await readFile(credentials, 'utf8')) });
		return;
	}
	const site = await startTestSite();
	project.provide('wordpress', { url: site.url, admin: site.admin, author: site.author });
	return () => site.stop();
}
