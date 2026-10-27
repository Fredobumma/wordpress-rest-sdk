import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_OVERRIDES, generate, type RestIndex } from '../../src/codegen/generate.js';
import { parseRoute } from '../../src/codegen/routes.js';
import { paramsBody, typeOf } from '../../src/codegen/schema.js';

const coreIndex = JSON.parse(readFileSync('test/fixtures/core-index.json', 'utf8')) as RestIndex;

describe('parseRoute', () => {
	it('turns named groups into placeholders', () => {
		expect(parseRoute('/wp/v2/posts/(?P<parent>[\\d]+)/revisions/(?P<id>[\\d]+)')).toEqual({
			template: '/wp/v2/posts/{parent}/revisions/{id}',
			params: ['parent', 'id'],
			patterns: { parent: '[\\d]+', id: '[\\d]+' },
		});
	});

	it('handles nested groups and parentheses inside character classes', () => {
		const route = parseRoute(
			'/wp/v2/global-styles/themes/(?P<stylesheet>[\\/\\s%\\w\\.\\(\\)\\[\\]\\@_\\-]+)/variations',
		);
		expect(route?.template).toBe('/wp/v2/global-styles/themes/{stylesheet}/variations');
		expect(parseRoute('/wp/v2/users/(?P<user_id>(?:[\\d]+|me))/application-passwords')?.template).toBe(
			'/wp/v2/users/{user_id}/application-passwords',
		);
	});

	it('gives up on patterns that are not plain paths', () => {
		expect(parseRoute('/my-plugin/v1/(items|things)')).toBeNull();
		expect(parseRoute('/my-plugin/v1/items?')).toBeNull();
	});
});

describe('typeOf', () => {
	const post = {
		type: 'object',
		properties: {
			id: { type: 'integer', context: ['view', 'edit', 'embed'], readonly: true },
			title: {
				type: 'object',
				context: ['view', 'edit', 'embed'],
				properties: {
					raw: { type: 'string', context: ['edit'] },
					rendered: { type: 'string', context: ['view', 'edit', 'embed'], readonly: true },
				},
			},
			status: { type: 'string', enum: ['publish', 'draft'], context: ['view', 'edit'] },
			parent: { type: ['integer', 'null'], context: ['view'] },
			meta: { type: 'object', context: ['view', 'edit'], properties: [], additionalProperties: true },
		},
	};

	it('keeps only the properties of each context', () => {
		expect(typeOf(post, 'embed', 'response')).toBe(
			'{\n\t/** @readonly */\n\tid: number;\n\ttitle: {\n\t\t/** @readonly */\n\t\trendered: string;\n\t};\n}',
		);
		expect(typeOf(post, 'edit', 'response')).toContain('\t\traw: string;');
		expect(typeOf(post, 'view', 'response')).toContain(`\tstatus: "publish" | "draft";\n\tparent: number | null;`);
	});

	it('types free-form objects loosely', () => {
		expect(typeOf(post, 'view', 'response')).toContain('\tmeta: Record<string, unknown>;');
	});

	it('accepts a raw string for title-like params and drops read-only fields', () => {
		expect(typeOf(post.properties.title, null, 'params')).toBe('string | {\n\traw?: string;\n}');
	});

	it('makes params optional unless required or in the path', () => {
		expect(
			paramsBody(
				{
					id: { type: 'integer' },
					force: { type: 'boolean', default: false },
					reassign: { type: 'integer', required: true },
				},
				['id'],
			),
		).toBe('\tid: number;\n\t/** @default false */\n\tforce?: boolean;\n\treassign: number;');
	});
});

describe('generate', () => {
	const result = generate(coreIndex, { ...CORE_OVERRIDES, name: 'CoreRoutes' });
	const route = (key: string) => result.routes.find((entry) => entry.key === key);

	it('covers every core route', () => {
		expect(result.skipped).toEqual([]);
		expect(result.routes).toHaveLength(257);
	});

	it('knows how each response is shaped', () => {
		expect(route('GET /wp/v2/posts')).toMatchObject({ shape: 'list', resource: 'Post', batch: true });
		expect(route('GET /wp/v2/types')?.shape).toBe('keyed');
		expect(route('GET /wp/v2/settings')?.shape).toBe('item');
		expect(route('GET /wp/v2/block-types/{namespace}')?.shape).toBe('list');
		expect(route('DELETE /wp/v2/posts/{id}')?.shape).toBe('delete');
		expect(route('GET /wp-block-editor/v1/export')?.shape).toBe('binary');
		expect(route('POST /wp-abilities/v1/abilities/{name}/run')).toMatchObject({ shape: 'raw', response: 'unknown' });
	});

	it('names parameters after their routes', () => {
		expect(route('GET /wp/v2/users/{id}')?.params).toBe('UserGetParams');
		expect(route('GET /wp/v2/users/me')?.params).toBe('UserGetMeParams');
		expect(route('DELETE /wp/v2/users/{user_id}/application-passwords')?.params).toBe(
			'ApplicationPasswordDeleteAllParams',
		);
		expect(route('GET /wp/v2/icons/{collection}')?.params).toBe('IconListByCollectionParams');
		expect(route('GET /wp/v2/templates/{id}/autosaves')?.params).toBe('TemplateAutosaveListParams');
		expect(result.source).not.toMatch(/export (interface|type) \w+\d+\b/);
	});

	it('matches the committed core types', () => {
		const committed = readFileSync('src/generated/core.ts', 'utf8');
		const fresh = generate(coreIndex, {
			...CORE_OVERRIDES,
			name: 'CoreRoutes',
			source: committed.match(/^\/\/ Source: (.*)$/m)?.[1],
		}).source;
		// If this fails, run `pnpm generate:core`.
		expect(fresh === committed).toBe(true);
	});
});
