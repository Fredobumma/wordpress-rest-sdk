/**
 * The type layer that turns a generated route map into request and response
 * types. Everything here is compile-time only.
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Which variant of a resource WordPress returns. */
export type Context = 'view' | 'edit' | 'embed';

/** How a route's response relates to its resource type. */
export type Shape = 'list' | 'item' | 'keyed' | 'delete' | 'binary' | 'raw';

/** One entry of a generated route map. */
export interface RouteDefinition {
	params: object;
	resource: unknown;
	shape: Shape;
	batch: boolean;
	response?: unknown;
}

/** A route in `R`, written `METHOD /path`, such as `GET /wp/v2/posts/{id}`. */
export type RouteKey<R> = keyof R & string;

/** Routes in `R` that `/batch/v1` accepts. */
export type BatchRouteKey<R> = {
	[K in RouteKey<R>]: R[K] extends { batch: true } ? (K extends `GET ${string}` ? never : K) : never;
}[RouteKey<R>];

/** Routes in `R` whose GET returns a paginated array. */
export type ListRouteKey<R> = {
	[K in RouteKey<R>]: R[K] extends { shape: 'list' } ? (K extends `GET ${string}` ? K : never) : never;
}[RouteKey<R>];

export type MethodOf<K extends string> = K extends `${infer M extends Method} ${string}` ? M : never;
export type PathOf<K extends string> = K extends `${string} ${infer P}` ? P : never;

type Definition<R, K> = K extends keyof R ? R[K] : never;

/** A link in a response's `_links`. */
export interface Link {
	href: string;
	embeddable?: boolean;
	templated?: boolean;
	name?: string;
	taxonomy?: string;
	targetHints?: { allow?: Method[] };
	[key: string]: unknown;
}

/** The body WordPress sends with an error status. */
export interface ErrorBody {
	code: string;
	message: string;
	data?: {
		status?: number;
		/** Invalid parameters with a message each, or the names of missing ones. */
		params?: Record<string, string> | string[];
		details?: Record<string, ErrorBody>;
		[key: string]: unknown;
	} | null;
}

/**
 * Field paths accepted by `_fields`: top-level keys and one level of nesting,
 * such as `title.rendered` or `meta.isbn`.
 */
export type FieldPath<T> =
	| {
			[K in keyof T & string]:
				| K
				| (NonNullable<T[K]> extends readonly unknown[]
						? never
						: NonNullable<T[K]> extends object
							? `${K}.${keyof NonNullable<T[K]> & string}`
							: never);
	  }[keyof T & string]
	| '_links'
	| '_embedded';

type Head<F extends string> = F extends `${infer H}.${string}` ? H : F;
type Below<F extends string, K extends string> = F extends `${K}.${infer Rest}` ? Rest : never;

/** `T` reduced to the paths in `F`, the way WordPress applies `_fields`. */
export type PickFields<T, F extends string> = T extends readonly unknown[]
	? T
	: T extends object
		? {
				[K in keyof T as K extends Head<F> ? K : never]: K extends F ? T[K] : PickFields<T[K], Below<F, K & string>>;
			}
		: T;

/** The API index at `GET /wp-json/`: the site's identity, namespaces and authentication methods. */
export interface SiteIndex {
	name: string;
	description: string;
	/** The WordPress address. */
	url: string;
	/** The site address, which can differ from `url`. */
	home: string;
	/** Hours from UTC, sent as a string by some versions. */
	gmt_offset: number | string;
	timezone_string: string;
	page_for_posts: number;
	page_on_front: number;
	show_on_front: 'posts' | 'page' | (string & {});
	/** Namespaces such as `wp/v2`, including those plugins add. */
	namespaces: string[];
	authentication: {
		'application-passwords'?: { endpoints: { authorization: string } };
		[method: string]: unknown;
	};
	/** Every route with its methods and arguments. */
	routes: Record<string, { namespace: string; methods: Method[]; endpoints: unknown[]; [key: string]: unknown }>;
	site_logo: number;
	site_icon: number;
	site_icon_url: string;
	_links?: Record<string, Link[]>;
}

/** Parameters every route accepts, on top of its own. */
export interface GlobalParams<T = unknown> {
	/** Return only these fields. Narrows the response type to match. */
	_fields?: readonly FieldPath<T>[];
	/** Embed linked resources in `_embedded`: `true` for all, or the link relations to embed. */
	_embed?: true | readonly string[];
}

type Variants<D> = D extends { resource: { view: infer V; edit: infer E; embed: infer B } }
	? { view: V; edit: E; embed: B }
	: { view: unknown; edit: unknown; embed: unknown };

/** WordPress answers reads in the `view` context and writes in `edit`, unless told otherwise. */
export type ContextFor<K extends string, P> = P extends { context: infer C extends Context }
	? C
	: MethodOf<K> extends 'GET'
		? 'view'
		: 'edit';

/** The resource type `K` returns for parameters `P`. */
export type ResourceOf<R, K extends string, P = {}> = Variants<Definition<R, K>>[ContextFor<K, P>];

/** Everything a request to `K` accepts. */
export type ParamsOf<R, K extends string> =
	Definition<R, K> extends { params: infer P } ? P & GlobalParams<ResourceOf<R, K>> : never;

type Embeddable<T, P> = P extends { _embed: true | readonly string[] } ? T & { _embedded?: Embedded } : T;

/** The links WordPress can embed, typed for core's own relations. */
export interface Embedded {
	author?: Array<Record<string, unknown> | ErrorBody>;
	replies?: Array<Array<Record<string, unknown>>>;
	up?: Array<Record<string, unknown>>;
	'wp:featuredmedia'?: Array<Record<string, unknown> | ErrorBody>;
	'wp:term'?: Array<Array<Record<string, unknown>>>;
	[relation: string]: unknown;
}

/** One resource as returned for `P`, after `_fields` and `_embed`. */
export type ItemOf<T, P> = unknown extends T
	? unknown
	: P extends { _fields: readonly (infer F extends string)[] }
		? PickFields<Embeddable<T & { _links: Record<string, Link[]>; _embedded?: Embedded }, P>, F>
		: Embeddable<T & { _links?: Record<string, Link[]> }, P>;

/** What a DELETE returns when the item is removed rather than trashed. */
export interface Deleted<T> {
	deleted: true;
	previous: T;
}

/** The response body of `K` for parameters `P`. */
export type ResponseOf<R, K extends string, P = {}> =
	Definition<R, K> extends infer D
		? D extends { shape: 'raw'; response: infer Raw }
			? Raw
			: D extends { shape: 'binary' }
				? Blob
				: D extends { shape: 'list' }
					? Array<ItemOf<ResourceOf<R, K, P>, P>>
					: D extends { shape: 'keyed' }
						? Record<string, ItemOf<ResourceOf<R, K, P>, P>>
						: D extends { shape: 'delete' }
							? P extends { force: true }
								? Deleted<ItemOf<ResourceOf<R, K, P>, P>>
								: ItemOf<ResourceOf<R, K, P>, P> | Deleted<ItemOf<ResourceOf<R, K, P>, P>>
							: ItemOf<ResourceOf<R, K, P>, P>
		: never;

/** Rejects keys in `P` that `Allowed` doesn't declare, which generic inference would otherwise let through. */
export type Exact<P, Allowed> = P & { [K in Exclude<keyof P, keyof Allowed>]: never };

/** Routes in `R` that can be called without parameters. */
export type OptionalParamsKey<R> = {
	[K in RouteKey<R>]: R[K] extends { params: infer P } ? ({} extends P ? K : never) : never;
}[RouteKey<R>];

/** Routes in `R` with at least one required parameter, usually a path parameter. */
export type RequiredParamsKey<R> = Exclude<RouteKey<R>, OptionalParamsKey<R>>;

/** Per-request settings. */
export interface RequestOptions {
	signal?: AbortSignal;
	headers?: HeadersInit;
	/** Milliseconds before the request is aborted. Overrides the client's `timeout`. */
	timeout?: number;
}

/** A route's parameters without the path parameter `Id`, for methods that take it separately. */
export type WithoutId<P, Id extends string> = Omit<P, Id>;
