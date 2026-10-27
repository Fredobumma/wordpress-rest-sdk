/**
 * Where requests go. WordPress serves the REST API at `/wp-json/` with pretty
 * permalinks, and at `?rest_route=/` on any site, including ones without them.
 */

export interface ApiRoot {
	/** The root without a trailing slash, or the page `rest_route` is added to. */
	base: string;
	style: 'path' | 'query';
}

/**
 * Reads the API root from `url`. A URL ending in `/wp-json` or carrying
 * `rest_route` is a root already; anything else is taken as the site's
 * address, with the API at `/wp-json`.
 */
export function apiRoot(url: string, { exact = false } = {}): ApiRoot {
	const parsed = new URL(url);
	parsed.hash = '';
	if (parsed.searchParams.has('rest_route')) {
		parsed.searchParams.delete('rest_route');
		return { base: parsed.toString(), style: 'query' };
	}
	parsed.search = '';
	let path = parsed.pathname.replace(/\/+$/, '');
	if (!exact && !path.endsWith('/wp-json')) path += '/wp-json';
	parsed.pathname = path;
	return { base: parsed.toString().replace(/\/$/, ''), style: 'path' };
}

/** `/wp/v2/posts` under `root`, with an encoded query string appended. */
export function routeUrl(root: ApiRoot, path: string, query = ''): string {
	if (root.style === 'path') return `${root.base}${path}${query ? `?${query}` : ''}`;
	const separator = root.base.includes('?') ? '&' : '?';
	return `${root.base}${separator}rest_route=${encodeURI(path)}${query ? `&${query}` : ''}`;
}

/**
 * Fills `{name}` placeholders from `params` and returns the parameters left
 * over. Slashes stay unescaped, because WordPress routes match plugin files
 * (`akismet/akismet`) and template ids (`twentytwentyfive//home`) with them.
 */
export function fillPath(
	template: string,
	params: Record<string, unknown>,
): { path: string; rest: Record<string, unknown> } {
	const rest = { ...params };
	const path = template.replace(/\{(\w+)\}/g, (_, name: string) => {
		const value = rest[name];
		if (value === undefined || value === null || value === '') {
			throw new TypeError(`Missing the "${name}" path parameter for ${template}`);
		}
		delete rest[name];
		return encodeURIComponent(String(value)).replaceAll('%2F', '/');
	});
	return { path, rest };
}
