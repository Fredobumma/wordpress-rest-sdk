/**
 * Turns a WordPress REST index (fetched with `?context=help`) into a
 * TypeScript module: one interface per resource and context, one per set of
 * request parameters, and a route map that ties them together.
 */

import { endsWithParam, parseRoute } from './routes.js';
import { type JsonSchema, objectOf, paramsBody, typeOf } from './schema.js';

export interface IndexEndpoint {
	methods: string[];
	args?: Record<string, JsonSchema> | unknown[];
	allow_batch?: { v1?: boolean };
}

export interface IndexRoute {
	namespace?: string;
	methods: string[];
	endpoints: IndexEndpoint[];
	schema?: JsonSchema;
}

export interface RestIndex {
	name?: string;
	url?: string;
	namespaces?: string[];
	routes: Record<string, IndexRoute>;
}

export interface GenerateOptions {
	/** Name of the exported route map. Defaults to `Routes`. */
	name?: string;
	/** Only include routes in these namespaces, such as `wp/v2`. */
	namespaces?: string[];
	/** Routes whose collection GET returns an object keyed by slug, not an array. */
	keyed?: string[];
	/** Routes whose GET returns an array even though the path ends in a parameter. */
	list?: string[];
	/** Routes whose GET returns one object even though the path doesn't end in a parameter. */
	single?: string[];
	/** Routes that return a file instead of JSON. */
	binary?: string[];
	/**
	 * Explicit response types, keyed by `METHOD /route`, or by `/route` alone
	 * to cover every method.
	 */
	responses?: Record<string, string>;
	/** A line describing where the index came from, written into the file header. */
	source?: string;
}

/**
 * Response shapes for core WordPress that the index doesn't describe. They
 * were confirmed by calling each route on WordPress 7.1.
 */
export const CORE_OVERRIDES = {
	keyed: ['/wp/v2/types', '/wp/v2/statuses', '/wp/v2/taxonomies', '/wp/v2/menu-locations'],
	list: [
		'/wp/v2/block-types/{namespace}',
		'/wp/v2/icons/{collection}',
		'/wp/v2/global-styles/themes/{stylesheet}/variations',
	],
	single: [
		'/wp/v2/users/{user_id}/application-passwords/introspect',
		'/wp/v2/settings',
		'/wp/v2/view-config',
		'/wp/v2/templates/lookup',
		'/wp/v2/template-parts/lookup',
		'/wp-block-editor/v1/navigation-fallback',
		'/wp-block-editor/v1/url-details',
		'/wp-site-health/v1/*',
		'/oembed/1.0/*',
	],
	binary: ['/wp-block-editor/v1/export'],
	responses: {
		'DELETE /wp/v2/users/{user_id}/application-passwords': '{ deleted: boolean; count: number }',
		// The schema promises `{ result }`, but the ability's output is returned as is.
		'/wp-abilities/v1/abilities/{name}/run': 'unknown',
	},
} satisfies Required<Overrides>;

type Overrides = Pick<GenerateOptions, 'keyed' | 'list' | 'single' | 'binary' | 'responses'>;

export type Shape = 'list' | 'item' | 'keyed' | 'delete' | 'binary' | 'raw';

export interface GeneratedRoute {
	key: string;
	method: string;
	template: string;
	params: string;
	resource: string | null;
	shape: Shape;
	batch: boolean;
	response?: string;
}

export interface GenerateResult {
	source: string;
	routes: GeneratedRoute[];
	skipped: string[];
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function pascal(value: string): string {
	return value
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
}

function matches(template: string, patterns: readonly string[]): boolean {
	return patterns.some((pattern) =>
		pattern.endsWith('/*') ? template.startsWith(pattern.slice(0, -1)) : template === pattern,
	);
}

/** A deterministic JSON string, so equal schemas share one generated type. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.keys(value as object)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

/** `wp_template` on a revisions route → `TemplateRevision`. */
function resourceName(title: string | undefined, template: string, namespace: string | undefined): string {
	let base = title ? pascal(title.replace(/^wp[_-]/, '')) : pathName(template, namespace);
	if (!base || /^\d/.test(base)) base = `Resource${base}`;
	if (template.includes('/autosaves'))
		return base.endsWith('Revision') ? `${base.slice(0, -8)}Autosave` : `${base}Autosave`;
	if (template.includes('/revisions') && !base.endsWith('Revision')) return `${base}Revision`;
	return base;
}

/**
 * A name built from the path: `/wp/v2/templates/lookup` → `TemplatesLookup`,
 * and `/oembed/1.0/proxy` → `OembedProxy`. Core's own `wp/v2` namespace is
 * left out of the name; any other namespace is kept so plugin routes can't
 * collide with core ones.
 */
function pathName(template: string, namespace: string | undefined): string {
	const ns = namespace || namespaceOf(template);
	let path = template;
	if (ns && path.startsWith(`/${ns}`)) path = path.slice(ns.length + 1);
	const words = path.split('/').filter((segment) => segment && !segment.startsWith('{'));
	const prefix = ns && ns !== 'wp/v2' ? pascal(ns.replace(/\/v?[\d.]+$/, '').replace(/^wp-/, '')) : '';
	if (words.length > 0) return prefix + pascal(words.join(' '));
	if (!ns) return 'Site';
	return `${prefix || pascal(ns.replace(/\/v?[\d.]+$/, ''))}Namespace`;
}

/** `/batch/v1` → `batch/v1`, for routes registered without a namespace field. */
function namespaceOf(template: string): string {
	const [first, second] = template.split('/').filter(Boolean);
	return first && second && /^v?[\d.]+$/.test(second) ? `${first}/${second}` : '';
}

function action(method: string, shape: Shape, isItem: boolean, isSingle: boolean): string {
	if (method === 'GET') return shape === 'list' || shape === 'keyed' ? 'List' : 'Get';
	if (method === 'DELETE') return 'Delete';
	return isItem || isSingle ? 'Update' : 'Create';
}

/**
 * Tells apart routes that would otherwise share a parameters name:
 * `/wp/v2/users/me` → `Me`, `/wp/v2/icons/{collection}` → `ByCollection`,
 * and a collection-wide DELETE → `All`.
 */
function distinguisher(template: string, isSingle: boolean): string {
	const last = template.split('/').filter(Boolean).at(-1) ?? '';
	if (last.startsWith('{')) return `By${pascal(last.slice(1, -1))}`;
	return isSingle ? pascal(last) : 'All';
}

class Names {
	private byName = new Map<string, string>();
	private byKey = new Map<string, string>();

	/**
	 * Returns the name for `key`. When `preferred` is taken by something else,
	 * the first free `alternate` is used, and failing that a numbered name.
	 */
	claim(preferred: string, key: string, alternates: string[] = []): { name: string; isNew: boolean } {
		const existing = this.byKey.get(key);
		if (existing) return { name: existing, isNew: false };
		let name = [preferred, ...alternates].find((candidate) => !this.byName.has(candidate)) ?? preferred;
		for (let n = 2; this.byName.has(name); n++) name = `${preferred}${n}`;
		this.byName.set(name, key);
		this.byKey.set(key, name);
		return { name, isNew: true };
	}
}

interface PendingParams {
	key: string;
	preferred: string;
	alternate: string;
	/**
	 * Lower claims first: items, then collections, then lists filtered by a
	 * path parameter, then fixed paths. So `/users/{id}` gets the plain name and
	 * `/users/me` the suffixed one.
	 */
	priority: number;
	declare: (name: string) => string;
	name?: string;
}

export function generate(index: RestIndex, options: GenerateOptions = {}): GenerateResult {
	const mapName = options.name ?? 'Routes';
	const overrides: Required<Overrides> = {
		keyed: options.keyed ?? [],
		list: options.list ?? [],
		single: options.single ?? [],
		binary: options.binary ?? [],
		responses: options.responses ?? {},
	};

	const names = new Names();
	// Declarations in output order: resource types as text, parameters as an index into `pending`.
	const slots: Array<string | number> = [];
	const pending: PendingParams[] = [];
	const routes: GeneratedRoute[] = [];
	const skipped: string[] = [];
	const seenKeys = new Set<string>();

	for (const [pattern, route] of Object.entries(index.routes ?? {})) {
		const namespace = route.namespace;
		if (options.namespaces && !options.namespaces.includes(namespace ?? '')) continue;

		const parsed = parseRoute(pattern);
		if (!parsed) {
			skipped.push(pattern);
			continue;
		}
		const { template, params: pathParams } = parsed;
		const isItem = endsWithParam(template);
		const isSingle = matches(template, overrides.single) || template.endsWith('/me');

		// Routes sharing a schema share its type, but each names its parameters after itself.
		const schema = route.schema && typeof route.schema === 'object' ? route.schema : undefined;
		const base = schema ? resourceName(schema.title, template, namespace) : pathName(template, namespace);
		let resource: string | null = null;
		if (schema) {
			const claimed = names.claim(base, `resource:${canonical(schema)}`);
			resource = claimed.name;
			if (claimed.isNew) slots.push(resourceDeclarations(resource, schema));
		}

		for (const endpoint of route.endpoints ?? []) {
			const args = objectOf(endpoint.args as Record<string, JsonSchema> | unknown[] | undefined);
			const methods = [...endpoint.methods].sort((a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b));

			for (const method of methods) {
				const key = `${method} ${template}`;
				if (seenKeys.has(key)) continue;
				seenKeys.add(key);

				const response = overrides.responses[key] ?? overrides.responses[template];
				const shape = shapeFor(method, template, resource !== null, overrides, response);
				const verb = action(method, shape, isItem, isSingle);
				slots.push(pending.length);
				pending.push({
					key: `params:${base}:${verb}:${canonical({ args, pathParams })}`,
					preferred: `${base}${verb}Params`,
					alternate: `${base}${verb}${distinguisher(template, isSingle)}Params`,
					priority: isSingle ? 3 : isItem && shape === 'list' ? 2 : isItem ? 0 : 1,
					declare: (name) => {
						const body = paramsBody(args, pathParams);
						return body
							? `export interface ${name} {\n${body}\n}`
							: `// biome-ignore lint/complexity/noBannedTypes: this route takes no parameters\nexport type ${name} = {};`;
					},
				});
				routes.push({
					key,
					method,
					template,
					params: '',
					resource,
					shape,
					batch: endpoint.allow_batch?.v1 === true,
					response,
				});
			}
		}
	}

	const order = pending.map((_, i) => i).sort((a, b) => (pending[a]?.priority ?? 0) - (pending[b]?.priority ?? 0));
	for (const i of order) {
		const entry = pending[i];
		if (entry) entry.name = names.claim(entry.preferred, entry.key, [entry.alternate]).name;
	}

	const declarations: string[] = [];
	const declared = new Set<string>();
	for (const slot of slots) {
		if (typeof slot === 'string') {
			declarations.push(slot);
			continue;
		}
		const entry = pending[slot];
		const route = routes[slot];
		if (!entry?.name || !route) continue;
		route.params = entry.name;
		if (declared.has(entry.name)) continue;
		declared.add(entry.name);
		declarations.push(entry.declare(entry.name));
	}

	return { source: render(mapName, declarations, routes, options.source), routes, skipped };
}

function shapeFor(
	method: string,
	template: string,
	hasSchema: boolean,
	overrides: Required<Overrides>,
	response: string | undefined,
): Shape {
	if (response) return 'raw';
	if (matches(template, overrides.binary)) return 'binary';
	if (method === 'DELETE') return hasSchema ? 'delete' : 'item';
	if (method !== 'GET') return 'item';
	if (matches(template, overrides.list)) return 'list';
	if (endsWithParam(template)) return 'item';
	if (matches(template, overrides.keyed)) return 'keyed';
	if (matches(template, overrides.single) || template.endsWith('/me')) return 'item';
	return hasSchema ? 'list' : 'item';
}

function resourceDeclarations(name: string, schema: JsonSchema): string {
	const view = typeOf(schema, 'view', 'response', 0);
	const edit = typeOf(schema, 'edit', 'response', 0);
	const embed = typeOf(schema, 'embed', 'response', 0);
	const title = schema.title ? ` (\`${schema.title}\`)` : '';
	const out = [`/** A ${name}${title} as returned in the \`view\` context. */`, declare(name, view)];
	out.push(`/** A ${name} as returned in the \`edit\` context. */`);
	out.push(edit === view ? `export type ${name}Edit = ${name};` : declare(`${name}Edit`, edit));
	out.push(`/** A ${name} as returned in the \`embed\` context. */`);
	out.push(embed === view ? `export type ${name}Embed = ${name};` : declare(`${name}Embed`, embed));
	return out.join('\n');
}

function declare(name: string, type: string): string {
	return type.startsWith('{\n') ? `export interface ${name} ${type}` : `export type ${name} = ${type};`;
}

function render(mapName: string, declarations: string[], routes: GeneratedRoute[], source?: string): string {
	const header = [
		'// Generated by wordpress-rest-sdk. Do not edit by hand: regenerate instead.',
		...(source ? [`// Source: ${source}`] : []),
		'/* eslint-disable */',
	];

	const entries = routes.map((route) => {
		const resource = route.resource
			? `{ view: ${route.resource}; edit: ${route.resource}Edit; embed: ${route.resource}Embed }`
			: 'unknown';
		const response = route.response ? `; response: ${route.response}` : '';
		return `\t${JSON.stringify(route.key)}: { params: ${route.params}; resource: ${resource}; shape: '${route.shape}'; batch: ${route.batch}${response} };`;
	});

	return `${[
		header.join('\n'),
		...declarations,
		`/** Every route on the site, keyed by \`METHOD /path\`. */\nexport interface ${mapName} {\n${entries.join('\n')}\n}`,
	].join('\n\n')}\n`;
}
