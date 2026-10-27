/**
 * Finds a site's REST API root the way WordPress advertises it: in a `Link`
 * header on every page, and in a `<link>` tag in the HTML head.
 */

const REL = 'https://api.w.org/';

/** The API root from a `Link` header, if it names one. */
export function rootFromLinkHeader(header: string | null): string | null {
	if (!header) return null;
	for (const part of header.split(/,(?=\s*<)/)) {
		const match = part.match(/<([^>]+)>(.*)/);
		if (match?.[1] && /rel="?https:\/\/api\.w\.org\/"?/.test(match[2] ?? '')) return match[1];
	}
	return null;
}

/** The API root from a page's `<link rel="https://api.w.org/">`, if it has one. */
export function rootFromHtml(html: string): string | null {
	for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
		if (!tag.includes(`"${REL}"`) && !tag.includes(`'${REL}'`)) continue;
		const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
		if (href) return href.replaceAll('&amp;', '&');
	}
	return null;
}

export interface DiscoverOptions {
	fetch?: typeof globalThis.fetch;
	signal?: AbortSignal;
}

/**
 * Returns the REST API root of the WordPress site at `url`, such as
 * `https://example.com/wp-json/` or, without pretty permalinks,
 * `https://example.com/?rest_route=/`. Pass it to `createClient({ root })`.
 */
export async function discover(url: string, options: DiscoverOptions = {}): Promise<string> {
	const fetch = options.fetch ?? globalThis.fetch;
	const response = await fetch(url, { signal: options.signal, redirect: 'follow' });
	const fromHeader = rootFromLinkHeader(response.headers.get('link'));
	if (fromHeader) {
		await response.body?.cancel();
		return fromHeader;
	}
	const fromHtml = rootFromHtml(await response.text());
	if (fromHtml) return new URL(fromHtml, response.url || url).toString();
	throw new Error(`${url} doesn't advertise a WordPress REST API. Is it a WordPress site with the REST API enabled?`);
}
