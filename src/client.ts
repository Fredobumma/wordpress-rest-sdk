import type { Id, RawOptions, Upload, WordPressClient } from './api.js';
import type { Auth } from './auth.js';
import { type BatchOptions, type BatchResult, MAX_BATCH_SIZE, type PreparedRequest, readBatch } from './batch.js';
import type { CoreRoutes } from './generated/core.js';
import { type Incoming, type Outgoing, Transport } from './http.js';
import { DEFAULT_PER_PAGE, type ListPage, loadPage, MAX_PER_PAGE, walk } from './pagination.js';
import { flatten, toQuery } from './query.js';
import type { Method, RequestOptions, SiteIndex } from './types.js';
import { apiRoot, fillPath } from './url.js';

export interface ClientOptions {
	/**
	 * The site's address, such as `https://example.com`, or its REST API root,
	 * such as `https://example.com/wp-json` or `https://example.com/?rest_route=/`.
	 */
	url?: string;
	/** The REST API root, used exactly as given. For sites that moved the API off `/wp-json`; see `discover()`. */
	root?: string;
	auth?: Auth;
	/** A `fetch` to use instead of the global one, for proxies, logging or tests. */
	fetch?: typeof globalThis.fetch;
	/** Headers sent with every request. */
	headers?: HeadersInit;
	/** Milliseconds before a request is aborted. Defaults to 30 seconds. */
	timeout?: number;
	/** How many times to retry a GET after a network error, 429 or 5xx. Defaults to 2. */
	retries?: number;
	/** Send PUT, PATCH and DELETE as POST with `X-HTTP-Method-Override`, for hosts that block those methods. */
	methodOverride?: boolean;
}

type Params = Record<string, unknown>;

/** Parameters WordPress only reads from the query string, or that read better there. */
const QUERY_ONLY = new Set(['_fields', '_embed', 'context']);

interface BatchResponse {
	failed?: 'validation';
	responses: Array<{ body: unknown; status: number; headers?: Record<string, string> } | null>;
}

/**
 * Creates a client for one WordPress site. Types come from `R`: stock
 * WordPress by default, or a route map generated from your site with
 * `npx wordpress-rest-sdk generate`, which adds its custom post types, fields and
 * plugin routes.
 */
export function createClient<R = CoreRoutes>(options: ClientOptions): WordPressClient<R> {
	const address = options.root ?? options.url;
	if (!address) throw new TypeError('createClient() needs a `url`: the site address or its REST API root.');

	const transport = new Transport({
		root: apiRoot(address, { exact: options.root !== undefined }),
		auth: options.auth,
		fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
		headers: new Headers(options.headers),
		timeout: options.timeout ?? 30_000,
		retries: options.retries ?? 2,
		methodOverride: options.methodOverride ?? false,
	});

	function compose(route: string, params: Params = {}, requestOptions: RequestOptions = {}): Outgoing {
		const space = route.indexOf(' ');
		if (space < 0) throw new TypeError(`Write routes as "METHOD /path", such as "GET /wp/v2/posts", not "${route}".`);
		const method = route.slice(0, space).toUpperCase() as Method;
		const { path, rest } = fillPath(route.slice(space + 1), params);
		const base = { method, path, ...requestOptions };
		if (method === 'GET' || method === 'DELETE') return { ...base, query: rest };

		const query: Params = {};
		const json: Params = {};
		for (const [key, value] of Object.entries(rest)) {
			if (QUERY_ONLY.has(key)) query[key] = value;
			else json[key] = value;
		}
		return { ...base, query, json };
	}

	const send = <T>(route: string, params?: Params, requestOptions?: RequestOptions) =>
		transport.send<T>(compose(route, params, requestOptions));

	const request = async (route: string, params?: Params, requestOptions?: RequestOptions) =>
		(await send(route, params, requestOptions)).data;

	const page = (route: string, params: Params = {}, requestOptions?: RequestOptions): Promise<ListPage<unknown>> =>
		loadPage(
			(n) => send<unknown[]>(route, { ...params, page: n }, requestOptions),
			Number(params.page ?? 1),
			Number(params.per_page ?? DEFAULT_PER_PAGE),
		);

	async function* paginate(route: string, params: Params = {}, requestOptions?: RequestOptions) {
		yield* walk(page(route, { per_page: MAX_PER_PAGE, ...params }, requestOptions));
	}

	async function all(route: string, params?: Params, requestOptions?: RequestOptions) {
		const items: unknown[] = [];
		for await (const item of paginate(route, params, requestOptions)) items.push(item);
		return items;
	}

	function prepare(route: string, params?: Params): PreparedRequest {
		const outgoing = compose(route, params);
		const query = toQuery(outgoing.query ?? {});
		const path = query ? `${outgoing.path}?${query}` : outgoing.path;
		return outgoing.json
			? { method: outgoing.method, path, body: outgoing.json as Params }
			: { method: outgoing.method, path };
	}

	async function batch(requests: readonly PreparedRequest[], batchOptions: BatchOptions & RequestOptions = {}) {
		const { validation = 'normal', ...requestOptions } = batchOptions;
		if (validation === 'require-all-validate' && requests.length > MAX_BATCH_SIZE) {
			throw new RangeError(
				`require-all-validate needs every request in one batch, and WordPress takes at most ${MAX_BATCH_SIZE}.`,
			);
		}
		const results: BatchResult<unknown>[] = [];
		for (let start = 0; start < requests.length; start += MAX_BATCH_SIZE) {
			const chunk = requests.slice(start, start + MAX_BATCH_SIZE);
			const { data } = await transport.send<BatchResponse>({
				method: 'POST',
				path: '/batch/v1',
				json: { validation, requests: chunk.map(({ method, path, body }) => ({ method, path, body })) },
				...requestOptions,
			});
			results.push(
				...readBatch(data, chunk, (path) => {
					const [route = '/', query] = path.split('?');
					return transport.url(route) + (query ? `${transport.url(route).includes('?') ? '&' : '?'}${query}` : '');
				}),
			);
		}
		return results;
	}

	function collection(base: string, { id = 'id', fixed = {} }: { id?: string; fixed?: Params } = {}) {
		const item = `${base}/{${id}}`;
		// Fixed parameters go last so a caller can't point the collection elsewhere.
		const scoped = (params?: Params) => ({ ...params, ...fixed });
		return {
			list: (params?: Params, o?: RequestOptions) => request(`GET ${base}`, scoped(params), o),
			page: (params?: Params, o?: RequestOptions) => page(`GET ${base}`, scoped(params), o),
			paginate: (params?: Params, o?: RequestOptions) => paginate(`GET ${base}`, scoped(params), o),
			all: (params?: Params, o?: RequestOptions) => all(`GET ${base}`, scoped(params), o),
			get: (value: Id, params?: Params, o?: RequestOptions) =>
				request(`GET ${item}`, { ...scoped(params), [id]: value }, o),
			create: (body: Params, o?: RequestOptions) => request(`POST ${base}`, scoped(body), o),
			update: (value: Id, body: Params, o?: RequestOptions) =>
				request(`POST ${item}`, { ...scoped(body), [id]: value }, o),
			delete: (value: Id, params?: Params, o?: RequestOptions) =>
				request(`DELETE ${item}`, { ...scoped(params), [id]: value }, o),
		};
	}

	const revisioned = (base: string) => ({
		...collection(base),
		revisions: (parent: Id) => collection(`${base}/{parent}/revisions`, { fixed: { parent } }),
		autosaves: (parent: Id) => ({
			list: (params?: Params, o?: RequestOptions) =>
				request(`GET ${base}/{id}/autosaves`, { ...params, id: parent }, o),
			get: (id: Id, params?: Params, o?: RequestOptions) =>
				request(`GET ${base}/{parent}/autosaves/{id}`, { ...params, parent, id }, o),
			create: (body: Params, o?: RequestOptions) => request(`POST ${base}/{id}/autosaves`, { ...body, id: parent }, o),
		}),
	});

	async function upload(file: Upload, fields: Params = {}, requestOptions: RequestOptions = {}) {
		const type = file.type ?? (file.file instanceof Blob ? file.file.type : '');
		const blob =
			file.file instanceof Blob && (!file.type || file.type === file.file.type)
				? file.file
				: new Blob([file.file as BlobPart], type ? { type } : {});
		const form = new FormData();
		form.append('file', blob, file.filename);
		const query: Params = {};
		const pairs: Array<[string, string]> = [];
		for (const [key, value] of Object.entries(fields)) {
			if (QUERY_ONLY.has(key)) query[key] = value;
			else flatten(key, value, pairs);
		}
		for (const [key, value] of pairs) form.append(key, value);
		const response = await transport.send({
			method: 'POST',
			path: '/wp/v2/media',
			query,
			body: form,
			...requestOptions,
		});
		return response.data;
	}

	// Which method each ability must be run with, looked up once per ability.
	const abilityMethods = new Map<string, Promise<Method>>();
	function abilityMethod(name: string, requestOptions?: RequestOptions): Promise<Method> {
		let method = abilityMethods.get(name);
		if (!method) {
			method = request('GET /wp-abilities/v1/abilities/{name}', { name }, requestOptions).then((ability) => {
				const annotations = (ability as { meta?: { annotations?: Record<string, unknown> } } | null)?.meta?.annotations;
				if (annotations?.readonly) return 'GET';
				if (annotations?.destructive && annotations.idempotent) return 'DELETE';
				return 'POST';
			});
			abilityMethods.set(name, method);
			method.catch(() => abilityMethods.delete(name));
		}
		return method;
	}

	const client = {
		request,
		page,
		paginate,
		all,
		prepare,
		batch,
		raw: (method: Method, path: string, { query, json, body, ...requestOptions }: RawOptions = {}) =>
			transport.send({ method, path, query, json, body, ...requestOptions }) as Promise<Incoming>,
		url: (path: string, query?: Params) => transport.url(path, query),
		collection: (path: string, collectionOptions?: { id?: string }) => collection(path, collectionOptions),

		site: (o?: RequestOptions) => request('GET /', {}, o),
		async authorizationEndpoint(o?: RequestOptions) {
			const index = (await request('GET /', { _fields: ['authentication'] }, o)) as Partial<SiteIndex> | null;
			return index?.authentication?.['application-passwords']?.endpoints.authorization ?? null;
		},

		posts: revisioned('/wp/v2/posts'),
		pages: revisioned('/wp/v2/pages'),
		media: { ...collection('/wp/v2/media'), upload },
		comments: collection('/wp/v2/comments'),
		categories: collection('/wp/v2/categories'),
		tags: collection('/wp/v2/tags'),
		users: {
			...collection('/wp/v2/users'),
			me: (params?: Params, o?: RequestOptions) => request('GET /wp/v2/users/me', params, o),
			updateMe: (body: Params, o?: RequestOptions) => request('POST /wp/v2/users/me', body, o),
			applicationPasswords: (user: Id) => ({
				...collection('/wp/v2/users/{user_id}/application-passwords', { id: 'uuid', fixed: { user_id: user } }),
				introspect: (o?: RequestOptions) =>
					request('GET /wp/v2/users/{user_id}/application-passwords/introspect', { user_id: user }, o),
				deleteAll: (o?: RequestOptions) =>
					request('DELETE /wp/v2/users/{user_id}/application-passwords', { user_id: user }, o),
			}),
		},
		blocks: revisioned('/wp/v2/blocks'),
		templates: revisioned('/wp/v2/templates'),
		templateParts: revisioned('/wp/v2/template-parts'),
		navigation: revisioned('/wp/v2/navigation'),
		menus: collection('/wp/v2/menus'),
		menuItems: collection('/wp/v2/menu-items'),
		menuLocations: collection('/wp/v2/menu-locations', { id: 'location' }),
		widgets: collection('/wp/v2/widgets'),
		sidebars: collection('/wp/v2/sidebars'),
		plugins: collection('/wp/v2/plugins', { id: 'plugin' }),
		themes: collection('/wp/v2/themes', { id: 'stylesheet' }),
		fontFamilies: {
			...collection('/wp/v2/font-families'),
			faces: (family: Id) =>
				collection('/wp/v2/font-families/{font_family_id}/font-faces', { fixed: { font_family_id: family } }),
		},
		types: collection('/wp/v2/types', { id: 'type' }),
		statuses: collection('/wp/v2/statuses', { id: 'status' }),
		taxonomies: collection('/wp/v2/taxonomies', { id: 'taxonomy' }),
		blockTypes: {
			list: (params?: Params, o?: RequestOptions) => request('GET /wp/v2/block-types', params, o),
			get: (name: string, params?: Params, o?: RequestOptions) => {
				const slash = name.indexOf('/');
				return request(
					'GET /wp/v2/block-types/{namespace}/{name}',
					{ ...params, namespace: name.slice(0, slash), name: name.slice(slash + 1) },
					o,
				);
			},
		},
		search: collection('/wp/v2/search'),
		settings: {
			get: (params?: Params, o?: RequestOptions) => request('GET /wp/v2/settings', params, o),
			update: (body: Params, o?: RequestOptions) => request('POST /wp/v2/settings', body, o),
		},
		abilities: {
			...collection('/wp-abilities/v1/abilities', { id: 'name' }),
			categories: collection('/wp-abilities/v1/categories', { id: 'slug' }),
			async run(
				name: string,
				input?: unknown,
				{ method, ...requestOptions }: RequestOptions & { method?: Method } = {},
			) {
				const verb = method ?? (await abilityMethod(name, requestOptions));
				const params = input === undefined ? { name } : { name, input };
				return request(`${verb} /wp-abilities/v1/abilities/{name}/run`, params, requestOptions);
			},
		},
	};

	// The runtime is deliberately untyped; `WordPressClient<R>` describes it.
	return client as unknown as WordPressClient<R>;
}
