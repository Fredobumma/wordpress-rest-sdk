#!/usr/bin/env node
/**
 * `wordpress-rest-sdk generate`: writes types for every route on a site,
 * including custom post types, registered meta and plugin routes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import type { Auth } from '../auth.js';
import { createClient } from '../client.js';
import { CORE_OVERRIDES, type GenerateOptions, generate, type RestIndex } from './generate.js';

const HELP = `Usage: wordpress-rest-sdk generate [options]

Writes a TypeScript route map for a WordPress site. Pass it to createClient():

  import type { Routes } from './wordpress.js';
  const wp = createClient<Routes>({ url: 'https://example.com' });

Options:
  --url <url>          The site address or REST API root to read routes from
  --file <path>        Read a saved index (GET /wp-json/?context=help) instead
  --out <path>         Where to write the module (default: standard output)
  --name <name>        The route map's name (default: Routes)
  --namespace <ns>     Only include routes in this namespace, such as wp/v2; repeatable
  --overrides <path>   JSON with extra { keyed, list, single, binary, responses } rules
  --save-index <path>  Also save the index that was read, for --file later
  --username <name>    Application password user, for routes only signed-in users see
  --password <pass>    Application password (or set WORDPRESS_USERNAME / WORDPRESS_PASSWORD)
  --token <token>      Bearer token (or set WORDPRESS_TOKEN)
  -h, --help           Show this help
`;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			url: { type: 'string' },
			file: { type: 'string' },
			out: { type: 'string' },
			name: { type: 'string' },
			namespace: { type: 'string', multiple: true },
			overrides: { type: 'string' },
			'save-index': { type: 'string' },
			username: { type: 'string' },
			password: { type: 'string' },
			token: { type: 'string' },
			help: { type: 'boolean', short: 'h' },
		},
	});

	const command = positionals[0];
	if (values.help || !command) {
		process.stdout.write(HELP);
		return values.help ? 0 : 1;
	}
	if (command !== 'generate') {
		process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
		return 1;
	}
	if (!values.url === !values.file) {
		process.stderr.write('Pass either --url or --file.\n');
		return 1;
	}

	let index: RestIndex;
	let source: string;
	if (values.file) {
		index = JSON.parse(await readFile(values.file, 'utf8')) as RestIndex;
		source = index.url ?? values.file;
	} else {
		const url = values.url as string;
		const username = values.username ?? process.env.WORDPRESS_USERNAME;
		const password = values.password ?? process.env.WORDPRESS_PASSWORD;
		const token = values.token ?? process.env.WORDPRESS_TOKEN;
		const auth: Auth | undefined = token ? { token } : username && password ? { username, password } : undefined;
		const client = createClient({ url, auth });
		index = (await client.raw<RestIndex>('GET', '/', { query: { context: 'help' } })).data;
		source = url;
	}
	if (!index || typeof index.routes !== 'object') {
		process.stderr.write("That doesn't look like a WordPress REST index: it has no routes.\n");
		return 1;
	}
	if (values['save-index']) await write(values['save-index'], `${JSON.stringify(index, null, '\t')}\n`);

	const extra = values.overrides
		? (JSON.parse(await readFile(values.overrides, 'utf8')) as Partial<typeof CORE_OVERRIDES>)
		: {};
	const options: GenerateOptions = {
		name: values.name ?? 'Routes',
		namespaces: values.namespace,
		keyed: [...CORE_OVERRIDES.keyed, ...(extra.keyed ?? [])],
		list: [...CORE_OVERRIDES.list, ...(extra.list ?? [])],
		single: [...CORE_OVERRIDES.single, ...(extra.single ?? [])],
		binary: [...CORE_OVERRIDES.binary, ...(extra.binary ?? [])],
		responses: { ...CORE_OVERRIDES.responses, ...extra.responses },
		source,
	};

	const result = generate(index, options);
	if (values.out) {
		await write(values.out, result.source);
		const namespaces = new Set(result.routes.map((route) => route.template.split('/').slice(1, 3).join('/')));
		process.stderr.write(`Wrote ${result.routes.length} routes from ${namespaces.size} namespaces to ${values.out}\n`);
	} else {
		process.stdout.write(result.source);
	}
	if (result.skipped.length > 0) {
		process.stderr.write(
			`Skipped ${result.skipped.length} routes whose patterns can't be written as paths:\n${result.skipped.map((route) => `  ${route}`).join('\n')}\n`,
		);
	}
	return 0;
}

async function write(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	},
);
