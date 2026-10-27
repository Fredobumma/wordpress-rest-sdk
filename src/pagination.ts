import type { Incoming } from './http.js';

/** One page of a collection, with WordPress's totals. */
export interface ListPage<T> {
	items: T[];
	/** The page number, starting at 1. */
	page: number;
	perPage: number;
	/** `X-WP-Total`, or `null` when the route doesn't report it. */
	total: number | null;
	/** `X-WP-TotalPages`, or `null` when the route doesn't report it. */
	totalPages: number | null;
	hasNextPage: boolean;
	/** The following page, or `null` after the last one. */
	next(): Promise<ListPage<T> | null>;
}

/** WordPress's `per_page` default. */
export const DEFAULT_PER_PAGE = 10;
/** The largest `per_page` core collections accept, used when walking every page. */
export const MAX_PER_PAGE = 100;

function count(headers: Headers, name: string): number | null {
	const value = headers.get(name);
	if (value === null) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Fetches page `page` with `load` and links it to the next. */
export async function loadPage<T>(
	load: (page: number) => Promise<Incoming<T[]>>,
	page: number,
	perPage: number,
): Promise<ListPage<T>> {
	const { data, headers } = await load(page);
	const total = count(headers, 'x-wp-total');
	const totalPages = count(headers, 'x-wp-totalpages');
	const items = Array.isArray(data) ? data : [];
	const hasNextPage = totalPages !== null && page < totalPages && items.length > 0;
	return {
		items,
		page,
		perPage,
		total,
		totalPages,
		hasNextPage,
		next: () => (hasNextPage ? loadPage(load, page + 1, perPage) : Promise.resolve(null)),
	};
}

/** Every item from `first` onwards, fetching pages as they're needed. */
export async function* walk<T>(first: Promise<ListPage<T>>): AsyncGenerator<T, void, undefined> {
	let page: ListPage<T> | null = await first;
	while (page) {
		yield* page.items;
		page = await page.next();
	}
}
