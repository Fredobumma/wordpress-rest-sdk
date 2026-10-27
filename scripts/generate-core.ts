/**
 * Regenerates `src/generated/core.ts` from a stock WordPress.
 *
 *   pnpm generate:core               boots WordPress Playground and reads it
 *   pnpm generate:core --url <site>  reads an existing site instead
 *
 * The index is also saved to `test/fixtures/core-index.json` so the generator's
 * tests run against exactly what was shipped.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { CORE_OVERRIDES, generate } from '../src/codegen/generate.js';
import { startPlayground } from '../test/support/playground.js';

const urlFlag = process.argv.indexOf('--url');
const given = urlFlag === -1 ? undefined : process.argv[urlFlag + 1];

const server = given ? undefined : await startPlayground({ blueprint: 'scripts/core.blueprint.json' });
const site = (given ?? server?.url ?? '').replace(/\/$/, '');

try {
	const html = await (await fetch(`${site}/`)).text();
	const version = html.match(/<meta name="generator" content="WordPress ([^"]+)"/)?.[1] ?? 'unknown';
	const index = await (await fetch(`${site}/wp-json/?context=help`)).json();

	writeFileSync('test/fixtures/core-index.json', `${JSON.stringify(index, null, '\t')}\n`);

	const result = generate(index, {
		...CORE_OVERRIDES,
		name: 'CoreRoutes',
		source: `a stock WordPress ${version} with no plugins`,
	});
	mkdirSync('src/generated', { recursive: true });
	writeFileSync('src/generated/core.ts', result.source);
	console.log(`WordPress ${version}: ${result.routes.length} routes written to src/generated/core.ts`);
	if (result.skipped.length > 0) console.warn(`Skipped ${result.skipped.length}:`, result.skipped);
} finally {
	await server?.stop();
}
