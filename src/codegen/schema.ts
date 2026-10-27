/**
 * Converts the JSON Schema WordPress publishes for each route into TypeScript.
 *
 * WordPress adds one thing standard converters don't understand: a `context`
 * array on every property, saying whether the field appears in `view`, `edit`
 * or `embed` responses. Types are generated once per context so that, for
 * example, `content.raw` only exists on the `edit` variant of a post.
 */

export type Context = 'view' | 'edit' | 'embed';

export const CONTEXTS: readonly Context[] = ['view', 'edit', 'embed'];

export interface JsonSchema {
	type?: string | string[];
	title?: string;
	description?: string;
	format?: string;
	enum?: unknown[];
	oneOf?: JsonSchema[];
	anyOf?: JsonSchema[];
	properties?: Record<string, JsonSchema> | unknown[];
	patternProperties?: Record<string, JsonSchema>;
	additionalProperties?: boolean | JsonSchema;
	items?: JsonSchema | JsonSchema[];
	context?: string[];
	readonly?: boolean;
	required?: boolean | string[];
	default?: unknown;
	[key: string]: unknown;
}

export type Mode = 'response' | 'params';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A primitive type or a union of literals, which reads fine both alone and as a list. */
const LITERAL = String.raw`(?:string|number|boolean|"(?:[^"\\]|\\.)*"|-?\d[\d.]*|true|false)`;
const SCALAR = new RegExp(`^${LITERAL}(?: \\| ${LITERAL})*$`);

export function propertyKey(name: string): string {
	return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/** WordPress serialises empty PHP arrays as `[]`, even where an object is meant. */
export function objectOf<T>(value: Record<string, T> | unknown[] | undefined): Record<string, T> {
	if (!value || Array.isArray(value)) return {};
	return value;
}

function includedIn(schema: JsonSchema, context: Context | null): boolean {
	if (!context || !Array.isArray(schema.context)) return true;
	return schema.context.includes(context);
}

function union(parts: string[]): string {
	const unique = [...new Set(parts)];
	if (unique.length === 0) return 'never';
	if (unique.includes('unknown')) return 'unknown';
	return unique.join(' | ');
}

function arrayOf(item: string): string {
	return /^[\w.]+$/.test(item) || item.endsWith(']') ? `${item}[]` : `Array<${item}>`;
}

function literal(value: unknown): string {
	if (value === null) return 'null';
	if (['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value);
	return 'unknown';
}

function docComment(schema: JsonSchema, mode: Mode, pad: string): string {
	const lines: string[] = [];
	if (typeof schema.description === 'string' && schema.description.trim()) {
		lines.push(...schema.description.trim().split('\n'));
	}
	if (typeof schema.format === 'string') lines.push(`@format ${schema.format}`);
	if (mode === 'params' && schema.default !== undefined && !Array.isArray(schema.default)) {
		const value = JSON.stringify(schema.default);
		if (value && value.length < 60) lines.push(`@default ${value}`);
	}
	if (mode === 'response' && schema.readonly === true) lines.push('@readonly');
	if (lines.length === 0) return '';
	const safe = lines.map((line) => line.replaceAll('*/', '*\\/'));
	if (safe.length === 1) return `${pad}/** ${safe[0]} */\n`;
	return `${pad}/**\n${safe.map((line) => `${pad} * ${line}`).join('\n')}\n${pad} */\n`;
}

/**
 * The TypeScript type for `schema`, with properties outside `context` left out.
 * `indent` is the nesting depth used for object literals.
 */
export function typeOf(schema: JsonSchema | undefined, context: Context | null, mode: Mode, indent = 0): string {
	if (!schema || typeof schema !== 'object') return 'unknown';

	const variants = schema.oneOf ?? schema.anyOf;
	if (Array.isArray(variants) && variants.length > 0) {
		const nullable = Array.isArray(schema.type) && schema.type.includes('null');
		const parts = variants.map((variant) => typeOf(variant, context, mode, indent));
		return union(nullable ? [...parts, 'null'] : parts);
	}

	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const parts = schema.enum.map(literal);
		if (Array.isArray(schema.type) && schema.type.includes('null')) parts.push('null');
		return union(parts);
	}

	let types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
	if (types.length === 0) {
		if (schema.properties || schema.additionalProperties || schema.patternProperties) types = ['object'];
		else if (schema.items) types = ['array'];
		else return 'unknown';
	}

	return union(types.map((type) => singleType(type, schema, context, mode, indent)));
}

function singleType(type: string, schema: JsonSchema, context: Context | null, mode: Mode, indent: number): string {
	switch (type) {
		case 'string':
			return 'string';
		case 'integer':
		case 'number':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'null':
			return 'null';
		case 'array': {
			const item = Array.isArray(schema.items)
				? union(schema.items.map((entry) => typeOf(entry, context, mode, indent)))
				: schema.items
					? typeOf(schema.items, context, mode, indent)
					: 'unknown';
			// WordPress turns a single value into a one-item list, so `status: 'draft'` works.
			if (mode === 'params' && SCALAR.test(item)) return `${item} | ${arrayOf(item)}`;
			return arrayOf(item);
		}
		case 'object':
			return objectType(schema, context, mode, indent);
		default:
			return 'unknown';
	}
}

function objectType(schema: JsonSchema, context: Context | null, mode: Mode, indent: number): string {
	const properties = Object.entries(
		objectOf(schema.properties as Record<string, JsonSchema> | unknown[] | undefined),
	).filter(([, property]) => includedIn(property, context));
	// WordPress ignores read-only fields it receives, such as `title.rendered`.
	const accepted = mode === 'params' ? properties.filter(([, property]) => property.readonly !== true) : properties;
	const extra = indexSignature(schema, context, mode, indent);

	if (accepted.length === 0) {
		if (extra) return `Record<string, ${extra}>`;
		// A declared object with nothing left in this context is still an object.
		return Object.keys(objectOf(schema.properties as Record<string, JsonSchema> | unknown[] | undefined)).length > 0
			? '{}'
			: 'Record<string, unknown>';
	}

	const pad = '\t'.repeat(indent + 1);
	const lines = accepted.map(([name, property]) => {
		const optional = mode === 'params' ? property.required !== true : false;
		const value = typeOf(property, context, mode, indent + 1);
		return `${docComment(property, mode, pad)}${pad}${propertyKey(name)}${optional ? '?' : ''}: ${value};`;
	});
	// Named properties must fit the index signature, so extra keys are typed loosely.
	if (extra) lines.push(`${pad}[key: string]: unknown;`);
	const type = `{\n${lines.join('\n')}\n${'\t'.repeat(indent)}}`;
	// Fields such as `title` and `content` are objects in the schema, but WordPress also accepts the raw string.
	if (mode === 'params' && accepted.some(([name]) => name === 'raw')) return `string | ${type}`;
	return type;
}

/** The value type of keys not listed in `properties`, or `null` if there are none. */
function indexSignature(schema: JsonSchema, context: Context | null, mode: Mode, indent: number): string | null {
	const parts: string[] = [];
	if (schema.patternProperties && typeof schema.patternProperties === 'object') {
		for (const value of Object.values(schema.patternProperties)) parts.push(typeOf(value, context, mode, indent + 1));
	}
	if (schema.additionalProperties === true) parts.push('unknown');
	else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
		parts.push(typeOf(schema.additionalProperties, context, mode, indent + 1));
	}
	return parts.length > 0 ? union(parts) : null;
}

/**
 * The body of an interface for request parameters: each argument is optional
 * unless WordPress marks it `required`.
 */
export function paramsBody(args: Record<string, JsonSchema>, pathParams: readonly string[]): string {
	const lines = Object.entries(args).map(([name, schema]) => {
		const required = schema.required === true || pathParams.includes(name);
		const value = typeOf(schema, null, 'params', 1);
		return `${docComment(schema, 'params', '\t')}\t${propertyKey(name)}${required ? '' : '?'}: ${value};`;
	});
	for (const name of pathParams) {
		if (!(name in args)) lines.push(`\t${propertyKey(name)}: string | number;`);
	}
	return lines.join('\n');
}
