/**
 * WordPress registers routes as PCRE patterns, such as
 * `/wp/v2/posts/(?P<parent>[\d]+)/revisions/(?P<id>[\d]+)`. These helpers turn
 * a pattern into the template the SDK uses (`/wp/v2/posts/{parent}/revisions/{id}`)
 * and report the named parameters in order.
 */

export interface RouteTemplate {
	/** The route with every named group replaced by `{name}`. */
	template: string;
	/** Named path parameters, in the order they appear. */
	params: string[];
	/** The regex each parameter must match, keyed by name. */
	patterns: Record<string, string>;
}

/** Characters that mean regex syntax is still present after substitution. */
const LEFTOVER_REGEX = /[()[\]?*+\\|^$]/;

/**
 * Finds the index of the parenthesis that closes the group opened at `open`,
 * skipping escaped characters and character classes.
 */
function closingParen(source: string, open: number): number {
	let depth = 0;
	let inClass = false;
	for (let i = open; i < source.length; i++) {
		const char = source[i];
		if (char === '\\') {
			i++;
			continue;
		}
		if (inClass) {
			if (char === ']') inClass = false;
			continue;
		}
		if (char === '[') {
			inClass = true;
			continue;
		}
		if (char === '(') depth++;
		if (char === ')') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Converts a WordPress route pattern into a template. Returns `null` when the
 * pattern contains regex that can't be expressed as a plain path, so callers
 * can skip it instead of generating a route nobody could call.
 */
export function parseRoute(pattern: string): RouteTemplate | null {
	const params: string[] = [];
	const patterns: Record<string, string> = {};
	let template = '';
	let i = 0;

	while (i < pattern.length) {
		if (pattern.startsWith('(?P<', i)) {
			const nameEnd = pattern.indexOf('>', i);
			const close = closingParen(pattern, i);
			if (nameEnd === -1 || close === -1) return null;
			const name = pattern.slice(i + 4, nameEnd);
			params.push(name);
			patterns[name] = pattern.slice(nameEnd + 1, close);
			template += `{${name}}`;
			i = close + 1;
			continue;
		}
		template += pattern[i];
		i++;
	}

	if (LEFTOVER_REGEX.test(template)) return null;
	return { template, params, patterns };
}

/** `/wp/v2/posts/{id}` → `true`: the route addresses one item. */
export function endsWithParam(template: string): boolean {
	return template.endsWith('}');
}
