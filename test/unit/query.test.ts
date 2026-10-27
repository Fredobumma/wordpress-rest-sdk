import { describe, expect, it } from 'vitest';
import { toQuery } from '../../src/query.js';

describe('toQuery', () => {
	it('encodes arrays and objects the way PHP parses them', () => {
		expect(toQuery({ categories: [1, 2], meta: { isbn: '978 0' } })).toBe(
			'categories[]=1&categories[]=2&meta[isbn]=978%200',
		);
	});

	it('indexes arrays of objects so PHP keeps them apart', () => {
		expect(toQuery({ tax: [{ terms: [1] }, { terms: [2] }] })).toBe('tax[0][terms][]=1&tax[1][terms][]=2');
	});

	it('joins _fields and _embed with commas', () => {
		expect(toQuery({ _fields: ['id', 'title.rendered'], _embed: ['author', 'wp:term'] })).toBe(
			'_fields=id,title.rendered&_embed=author,wp%3Aterm',
		);
		expect(toQuery({ _embed: true })).toBe('_embed=1');
	});

	it('writes dates as ISO 8601 and booleans as words', () => {
		expect(toQuery({ after: new Date(Date.UTC(2026, 0, 2)), sticky: false })).toBe(
			'after=2026-01-02T00%3A00%3A00.000Z&sticky=false',
		);
	});

	it('leaves out undefined, null and empty lists', () => {
		expect(toQuery({ a: undefined, b: null, c: [], _fields: [] })).toBe('');
	});
});
