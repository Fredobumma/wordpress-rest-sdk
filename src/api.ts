/**
 * The client's public types. `R` is a generated route map: `CoreRoutes` for
 * stock WordPress, or one generated from your own site with the CLI.
 */

import type { BatchOptions, BatchResult, PreparedRequest } from './batch.js';
import type { Incoming } from './http.js';
import type { ListPage } from './pagination.js';
import type {
	Exact,
	ListRouteKey,
	Method,
	OptionalParamsKey,
	ParamsOf,
	RequestOptions,
	RequiredParamsKey,
	ResponseOf,
	RouteKey,
	SiteIndex,
} from './types.js';

/** A value for a path parameter: a numeric id, slug, plugin file or template id. */
export type Id = string | number;

/** The element type of a list response. */
export type ListItemOf<R, K extends string, P> = ResponseOf<R, K, P> extends readonly (infer T)[] ? T : never;

/** Whether `/batch/v1` accepts route `K`. */
type Batchable<R, K extends string> = K extends `GET ${string}`
	? false
	: K extends keyof R
		? R[K] extends { batch: true }
			? true
			: false
		: false;

/** `client.request()`: any route in `R`, typed from its parameters to its response. */
export interface Requester<R> {
	<K extends OptionalParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params?: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, K, P>>;
	<K extends RequiredParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, K, P>>;
}

/** `client.page()`: one page of a collection, with totals. */
export interface PageRequester<R> {
	<K extends ListRouteKey<R> & OptionalParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params?: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): Promise<ListPage<ListItemOf<R, K, P>>>;
	<K extends ListRouteKey<R> & RequiredParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): Promise<ListPage<ListItemOf<R, K, P>>>;
}

/** `client.paginate()`: every item of a collection, fetched page by page as you iterate. */
export interface Paginator<R> {
	<K extends ListRouteKey<R> & OptionalParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params?: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): AsyncGenerator<ListItemOf<R, K, P>, void, undefined>;
	<K extends ListRouteKey<R> & RequiredParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): AsyncGenerator<ListItemOf<R, K, P>, void, undefined>;
}

/** `client.all()`: every item of a collection in one array. */
export interface Collector<R> {
	<K extends ListRouteKey<R> & OptionalParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params?: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): Promise<Array<ListItemOf<R, K, P>>>;
	<K extends ListRouteKey<R> & RequiredParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params: Exact<P, ParamsOf<R, K>>,
		options?: RequestOptions,
	): Promise<Array<ListItemOf<R, K, P>>>;
}

/** `client.prepare()`: a request built but not sent, for `client.batch()` or inspection. */
export interface Preparer<R> {
	<K extends OptionalParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params?: Exact<P, ParamsOf<R, K>>,
	): PreparedRequest<ResponseOf<R, K, P>, Batchable<R, K>>;
	<K extends RequiredParamsKey<R>, const P extends ParamsOf<R, K>>(
		route: K,
		params: Exact<P, ParamsOf<R, K>>,
	): PreparedRequest<ResponseOf<R, K, P>, Batchable<R, K>>;
}

/** The results of a batch, in the same order and with the same types as its requests. */
export type BatchResults<T extends readonly PreparedRequest[]> = {
	-readonly [I in keyof T]: BatchResult<T[I] extends PreparedRequest<infer D> ? D : never>;
};

/** Parameters of route `K` without the ones a method fills in itself. */
type Rest<R, K extends string, Filled extends string> = Omit<ParamsOf<R, K>, Filled>;

/**
 * `[params?, options?]`, with `params` required when the route has required
 * parameters, such as `reassign` when deleting a user.
 */
export type Args<Params, P> = {} extends Params
	? [params?: Exact<P, Params>, options?: RequestOptions]
	: [params: Exact<P, Params>, options?: RequestOptions];

/**
 * A collection such as `/wp/v2/posts`: `B` is its path, `I` the name of its
 * item parameter, and `F` path parameters fixed when it was created, such as
 * a revision's `parent`.
 */
export interface Collection<R, B extends string, I extends string = 'id', F extends string = never> {
	/** One page of items, as an array. */
	list<const P extends Rest<R, `GET ${B}`, F>>(
		...args: Args<Rest<R, `GET ${B}`, F>, P>
	): Promise<ResponseOf<R, `GET ${B}`, P>>;
	/** One page of items, with totals and a way to the next. */
	page<const P extends Rest<R, `GET ${B}`, F>>(
		...args: Args<Rest<R, `GET ${B}`, F>, P>
	): Promise<ListPage<ListItemOf<R, `GET ${B}`, P>>>;
	/** Every item, fetched 100 at a time as you iterate. */
	paginate<const P extends Rest<R, `GET ${B}`, F>>(
		...args: Args<Rest<R, `GET ${B}`, F>, P>
	): AsyncGenerator<ListItemOf<R, `GET ${B}`, P>, void, undefined>;
	/** Every item in one array. */
	all<const P extends Rest<R, `GET ${B}`, F>>(
		...args: Args<Rest<R, `GET ${B}`, F>, P>
	): Promise<Array<ListItemOf<R, `GET ${B}`, P>>>;
	get<const P extends Rest<R, `GET ${B}/{${I}}`, F | I>>(
		id: Id,
		...args: Args<Rest<R, `GET ${B}/{${I}}`, F | I>, P>
	): Promise<ResponseOf<R, `GET ${B}/{${I}}`, P>>;
	create<const P extends Rest<R, `POST ${B}`, F>>(
		body: Exact<P, Rest<R, `POST ${B}`, F>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, `POST ${B}`, P>>;
	update<const P extends Rest<R, `POST ${B}/{${I}}`, F | I>>(
		id: Id,
		body: Exact<P, Rest<R, `POST ${B}/{${I}}`, F | I>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, `POST ${B}/{${I}}`, P>>;
	/** Moves the item to the trash, or deletes it for good with `{ force: true }`. */
	delete<const P extends Rest<R, `DELETE ${B}/{${I}}`, F | I>>(
		id: Id,
		...args: Args<Rest<R, `DELETE ${B}/{${I}}`, F | I>, P>
	): Promise<ResponseOf<R, `DELETE ${B}/{${I}}`, P>>;
}

type ReadOnly<C> = Pick<C, Extract<keyof C, 'list' | 'page' | 'paginate' | 'all' | 'get'>>;
type Listing<C> = Pick<C, Extract<keyof C, 'list' | 'page' | 'paginate' | 'all'>>;
type Keyed<C> = Pick<C, Extract<keyof C, 'list' | 'get'>>;

/** Autosaves of one post, page or template. WordPress names the parent `id` on some routes and `parent` on others. */
export interface Autosaves<R, B extends string> {
	list<const P extends Rest<R, `GET ${B}/{id}/autosaves`, 'id'>>(
		...args: Args<Rest<R, `GET ${B}/{id}/autosaves`, 'id'>, P>
	): Promise<ResponseOf<R, `GET ${B}/{id}/autosaves`, P>>;
	get<const P extends Rest<R, `GET ${B}/{parent}/autosaves/{id}`, 'id' | 'parent'>>(
		id: Id,
		...args: Args<Rest<R, `GET ${B}/{parent}/autosaves/{id}`, 'id' | 'parent'>, P>
	): Promise<ResponseOf<R, `GET ${B}/{parent}/autosaves/{id}`, P>>;
	create<const P extends Rest<R, `POST ${B}/{id}/autosaves`, 'id'>>(
		body: Exact<P, Rest<R, `POST ${B}/{id}/autosaves`, 'id'>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, `POST ${B}/{id}/autosaves`, P>>;
}

/** A post type with revisions and autosaves, such as posts and pages. */
export type Revisioned<R, B extends string> = Collection<R, B> & {
	revisions(parent: Id): Omit<Collection<R, `${B}/{parent}/revisions`, 'id', 'parent'>, 'create' | 'update'>;
	autosaves(parent: Id): Autosaves<R, B>;
};

/** What to upload: the file's bytes, its name, and optionally its type. */
export interface Upload {
	file: Blob | ArrayBuffer | ArrayBufferView;
	filename: string;
	/** The MIME type. Taken from `file` when it's a `Blob` with a type. */
	type?: string;
}

export type MediaApi<R> = Collection<R, '/wp/v2/media'> & {
	/** Uploads a file to the media library, with any attachment fields such as `alt_text` or `post`. */
	upload<const P extends Rest<R, 'POST /wp/v2/media', never>>(
		upload: Upload,
		fields?: Exact<P, Rest<R, 'POST /wp/v2/media', never>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, 'POST /wp/v2/media', P>>;
};

export type UsersApi<R> = Collection<R, '/wp/v2/users'> & {
	/** The user the client is authenticated as. */
	me<const P extends ParamsOf<R, 'GET /wp/v2/users/me'>>(
		...args: Args<ParamsOf<R, 'GET /wp/v2/users/me'>, P>
	): Promise<ResponseOf<R, 'GET /wp/v2/users/me', P>>;
	updateMe<const P extends ParamsOf<R, 'POST /wp/v2/users/me'>>(
		body: Exact<P, ParamsOf<R, 'POST /wp/v2/users/me'>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, 'POST /wp/v2/users/me', P>>;
	/** Application passwords of one user, or of the current user with `'me'`. */
	applicationPasswords(user: Id | 'me'): Omit<
		Collection<R, '/wp/v2/users/{user_id}/application-passwords', 'uuid', 'user_id'>,
		'page' | 'paginate' | 'all'
	> & {
		/** The application password the current request is authenticated with. */
		introspect(
			options?: RequestOptions,
		): Promise<ResponseOf<R, 'GET /wp/v2/users/{user_id}/application-passwords/introspect'>>;
		/** Revokes every application password of the user. */
		deleteAll(options?: RequestOptions): Promise<ResponseOf<R, 'DELETE /wp/v2/users/{user_id}/application-passwords'>>;
	};
};

export interface SettingsApi<R> {
	get<const P extends ParamsOf<R, 'GET /wp/v2/settings'>>(
		...args: Args<ParamsOf<R, 'GET /wp/v2/settings'>, P>
	): Promise<ResponseOf<R, 'GET /wp/v2/settings', P>>;
	update<const P extends ParamsOf<R, 'POST /wp/v2/settings'>>(
		body: Exact<P, ParamsOf<R, 'POST /wp/v2/settings'>>,
		options?: RequestOptions,
	): Promise<ResponseOf<R, 'POST /wp/v2/settings', P>>;
}

export type AbilitiesApi<R> = ReadOnly<Collection<R, '/wp-abilities/v1/abilities', 'name'>> & {
	categories: ReadOnly<Collection<R, '/wp-abilities/v1/categories', 'slug'>>;
	/**
	 * Runs an ability with `input`. The HTTP method WordPress requires (GET for
	 * read-only abilities, DELETE for destructive idempotent ones, POST
	 * otherwise) is looked up from the ability unless you pass `method`.
	 */
	run<T = unknown>(name: string, input?: unknown, options?: RequestOptions & { method?: Method }): Promise<T>;
};

export interface BlockTypesApi<R> {
	list<const P extends ParamsOf<R, 'GET /wp/v2/block-types'>>(
		...args: Args<ParamsOf<R, 'GET /wp/v2/block-types'>, P>
	): Promise<ResponseOf<R, 'GET /wp/v2/block-types', P>>;
	/** A block type by its full name, such as `core/paragraph`. */
	get<const P extends Rest<R, 'GET /wp/v2/block-types/{namespace}/{name}', 'namespace' | 'name'>>(
		name: `${string}/${string}`,
		...args: Args<Rest<R, 'GET /wp/v2/block-types/{namespace}/{name}', 'namespace' | 'name'>, P>
	): Promise<ResponseOf<R, 'GET /wp/v2/block-types/{namespace}/{name}', P>>;
}

export interface RawOptions extends RequestOptions {
	query?: Record<string, unknown>;
	/** Sent as JSON. */
	json?: unknown;
	/** Sent as is, such as `FormData`. */
	body?: BodyInit;
}

export interface WordPressClient<R> {
	/** Calls any route by its `METHOD /path`, with path parameters taken from `params`. */
	request: Requester<R>;
	/** One page of a collection, with `total`, `totalPages` and `next()`. */
	page: PageRequester<R>;
	/** Every item of a collection, fetched as you iterate with `for await`. */
	paginate: Paginator<R>;
	/** Every item of a collection in one array. */
	all: Collector<R>;
	/** Builds a request without sending it, for `batch()`. */
	prepare: Preparer<R>;
	/** Sends up to 25 writes in one HTTP request through `/batch/v1`; longer lists are split. */
	batch<const T extends readonly PreparedRequest<unknown, true>[]>(
		requests: T,
		options?: BatchOptions & RequestOptions,
	): Promise<BatchResults<T>>;
	/** Any request at all, untyped, with the status and headers. */
	raw<T = unknown>(method: Method, path: string, options?: RawOptions): Promise<Incoming<T>>;
	/** The URL a route resolves to, for logging or linking. */
	url(path: string, query?: Record<string, unknown>): string;
	/** A collection by path, for custom post types and plugin routes in `R`. */
	collection<B extends string, I extends string = 'id'>(path: B, options?: { id?: I }): Collection<R, B, I>;

	/** The site's name, description, namespaces, routes and authentication methods. */
	site(options?: RequestOptions): Promise<SiteIndex>;
	/** The URL of the page where users approve application passwords, or `null` if the site has them disabled. */
	authorizationEndpoint(options?: RequestOptions): Promise<string | null>;

	posts: Revisioned<R, '/wp/v2/posts'>;
	pages: Revisioned<R, '/wp/v2/pages'>;
	media: MediaApi<R>;
	comments: Collection<R, '/wp/v2/comments'>;
	categories: Collection<R, '/wp/v2/categories'>;
	tags: Collection<R, '/wp/v2/tags'>;
	users: UsersApi<R>;
	/** Synced patterns, formerly reusable blocks. */
	blocks: Revisioned<R, '/wp/v2/blocks'>;
	templates: Revisioned<R, '/wp/v2/templates'>;
	templateParts: Revisioned<R, '/wp/v2/template-parts'>;
	navigation: Revisioned<R, '/wp/v2/navigation'>;
	menus: Collection<R, '/wp/v2/menus'>;
	menuItems: Collection<R, '/wp/v2/menu-items'>;
	menuLocations: Keyed<Collection<R, '/wp/v2/menu-locations', 'location'>>;
	widgets: Collection<R, '/wp/v2/widgets'>;
	sidebars: Omit<ReadOnly<Collection<R, '/wp/v2/sidebars'>>, 'page' | 'paginate' | 'all'> &
		Pick<Collection<R, '/wp/v2/sidebars'>, 'update'>;
	plugins: Omit<Collection<R, '/wp/v2/plugins', 'plugin'>, 'page' | 'paginate' | 'all'>;
	themes: Keyed<Collection<R, '/wp/v2/themes', 'stylesheet'>>;
	fontFamilies: Collection<R, '/wp/v2/font-families'> & {
		faces(
			family: Id,
		): Omit<Collection<R, '/wp/v2/font-families/{font_family_id}/font-faces', 'id', 'font_family_id'>, 'update'>;
	};
	types: Keyed<Collection<R, '/wp/v2/types', 'type'>>;
	statuses: Keyed<Collection<R, '/wp/v2/statuses', 'status'>>;
	taxonomies: Keyed<Collection<R, '/wp/v2/taxonomies', 'taxonomy'>>;
	blockTypes: BlockTypesApi<R>;
	search: Listing<Collection<R, '/wp/v2/search'>>;
	settings: SettingsApi<R>;
	abilities: AbilitiesApi<R>;
}

/** Routes of `R`, for annotating your own helpers. */
export type RoutesOf<C> = C extends WordPressClient<infer R> ? RouteKey<R> : never;
