import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const expressRequire = createRequire(require.resolve('express'));
const qs = expressRequire('qs');

describe('query serialization through Express', () => {
  it.each([false, true])('handles hostile comma-array elements with encodeValuesOnly=%s', (encodeValuesOnly) => {
    const input = { items: [{ toString: 'not-callable' }] };
    expect(() => qs.stringify(input, { arrayFormat: 'comma', encodeValuesOnly })).not.toThrow();
    expect(qs.stringify(input, { arrayFormat: 'comma', encodeValuesOnly })).toContain('items=');
    expect(input.items[0].toString).toBe('not-callable');
  });
  it('preserves ordinary comma serialization and query parsing', () => {
    expect(qs.stringify({ items: ['a', 'b'] }, { arrayFormat: 'comma' })).toBe('items=a%2Cb');
    expect(qs.parse('items[]=a&items[]=b')).toEqual({ items: ['a', 'b'] });
  });
});
