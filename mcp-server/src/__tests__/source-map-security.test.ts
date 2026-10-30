import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { SourceMapConsumer, SourceNode } = require('source-map-js');
const flatMap = { version: 3, sources: ['fixture.ts'], names: [], mappings: 'AAAA', sourcesContent: ['value'] };

it.each([-1, 0.5, NaN, Infinity, 10_000_001])('rejects invalid indexed source-map line offset %s at construction', (line) => {
  expect(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line, column: 0 }, map: flatMap }] })).toThrow(/offset/i);
});

it('bounds cumulative offsets across nested indexed source maps', () => {
  const inner = { version: 3, sections: [{ offset: { line: 6_000_000, column: 0 }, map: flatMap }] };
  expect(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 6_000_000, column: 0 }, map: inner }] })).toThrow(/offset/i);
});

it('still maps and renders valid indexed sources', () => {
  const consumer = new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 1, column: 0 }, map: flatMap }] });
  expect(consumer.originalPositionFor({ line: 2, column: 1 })).toMatchObject({ source: 'fixture.ts', line: 1, column: 0 });
  expect(SourceNode.fromStringWithSourceMap('\nvalue', consumer).toString()).toBe('\nvalue');
});
