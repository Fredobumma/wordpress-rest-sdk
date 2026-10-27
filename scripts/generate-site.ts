/**
 * Regenerates `test/generated/site.ts`, the route map the type and
 * integration tests use for the test site's custom post type and meta.
 */

import { writeFile } from 'node:fs/promises';
import { createClient } from '../src/client.js';
import { CORE_OVERRIDES, generate, type RestIndex } from '../src/codegen/generate.js';
import { startTestSite } from '../test/support/site.js';

const site = await startTestSite();
try {
	const client = createClient({ url: site.url, auth: site.admin });
	const { data: index } = await client.raw<RestIndex>('GET', '/', { query: { context: 'help' } });
	await writeFile('test/fixtures/site-index.json', `${JSON.stringify(index, null, '\t')}\n`);
	const result = generate(index, { ...CORE_OVERRIDES, name: 'SiteRoutes', source: 'the integration test site' });
	await writeFile('test/generated/site.ts', result.source);
	console.log(`${result.routes.length} routes written to test/generated/site.ts`);
} finally {
	await site.stop();
}
