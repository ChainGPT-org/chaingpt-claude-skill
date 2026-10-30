import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'));
const ajvRequire = createRequire(sdkRequire.resolve('ajv'));
const uri = ajvRequire('fast-uri');

it.each(['javascript:alert(1)', 'data:text/plain,fixture', 'chapter:section'])(
  'keeps the first-segment colon inert in suffix reference %s', (reference) => {
    // A known synthetic scheme selects path/suffix parsing rather than the
    // default suffix-as-authority mode; the scheme itself is not emitted.
    const normalized = uri.normalize(reference, { reference: 'suffix', scheme: 'fixture' });
    expect(normalized.length).toBeGreaterThan(0);
    expect(uri.parse(normalized).scheme).toBeUndefined();
    expect(new URL(normalized, 'https://fixture.example/docs/').origin).toBe('https://fixture.example');
  },
);
