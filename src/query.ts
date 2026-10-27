/**
 * Encodes parameters the way PHP parses them, so nested values reach
 * WordPress intact: `categories[]=1&categories[]=2`, `meta[isbn]=123`.
 */

/** Parameters WordPress expects as one comma-separated value. */
const LISTS = new Set(['_fields', '_embed']);

function isScalar(value: unknown): boolean {
	return value === null || value instanceof Date || typeof value !== 'object';
}

/** Appends `value` to `out` under `key`, expanding arrays and objects into bracketed keys. */
export function flatten(key: string, value: unknown, out: Array<[string, string]>): void {
	if (value === undefined || value === null) return;
	if (value instanceof Date) {
		out.push([key, value.toISOString()]);
		return;
	}
	if (Array.isArray(value)) {
		// Scalars can share `key[]`; objects need an index to stay separate.
		for (const [index, item] of value.entries()) flatten(`${key}[${isScalar(item) ? '' : index}]`, item, out);
		return;
	}
	if (typeof value === 'object') {
		for (const [name, item] of Object.entries(value)) flatten(`${key}[${name}]`, item, out);
		return;
	}
	out.push([key, String(value)]);
}

/** Keeps brackets and commas readable; PHP decodes either form. */
function encode(value: string): string {
	return encodeURIComponent(value).replace(/%5B|%5D|%2C/g, (sequence) => decodeURIComponent(sequence));
}

/** A query string, without the leading `?`. */
export function toQuery(params: Record<string, unknown>): string {
	const pairs: Array<[string, string]> = [];
	for (const [key, value] of Object.entries(params)) {
		if (LISTS.has(key) && Array.isArray(value)) {
			if (value.length > 0) pairs.push([key, value.join(',')]);
		} else if (key === '_embed' && value === true) {
			pairs.push([key, '1']);
		} else {
			flatten(key, value, pairs);
		}
	}
	return pairs.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
}
