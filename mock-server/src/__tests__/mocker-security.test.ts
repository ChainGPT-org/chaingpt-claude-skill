import { pathToFileURL } from 'node:url';
import { MockerRegistry } from '@vitest/mocker';
import { describe, expect, it, vi } from 'vitest';

describe('mocker source and redirect security', () => {
  it.each(['url', 'export'])('keeps untrusted mock %s metadata inert in generated modules', async (kind) => {
    const { interceptorPlugin } = await import(pathToFileURL(require.resolve('@vitest/mocker/node')).href);
    const registry = new MockerRegistry();
    const moduleUrl = kind === 'url' ? '\"); globalThis.__moderateFixtureInjected = true; //' : '/safe-fixture';
    const name = kind === 'export' ? 'odd\"name\n' : 'value';
    const values = { [name]: 'fixture-value', default: 'fixture-default' };
    registry.register('manual', '/fixture', '/fixture', moduleUrl, async () => values);
    const plugin = interceptorPlugin({ registry, globalThisAccessor: '\"__moderateFixtureMocker\"' });
    const load = plugin.load as { handler: (id: string) => Promise<string> };
    const source = await load.handler('/fixture');
    const globals = globalThis as unknown as Record<string, unknown>;
    const factory = vi.fn(async () => values);
    const oldMocker = Object.getOwnPropertyDescriptor(globals, '__moderateFixtureMocker');
    const oldFlag = Object.getOwnPropertyDescriptor(globals, '__moderateFixtureInjected');
    Object.defineProperty(globals, '__moderateFixtureMocker', { configurable: true, value: { getFactoryModule: factory } });
    Reflect.deleteProperty(globals, '__moderateFixtureInjected');
    try {
      const loaded = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
      expect(loaded[name]).toBe('fixture-value');
      expect(loaded.default).toBe('fixture-default');
      expect(factory).toHaveBeenCalledWith(moduleUrl);
      expect(globals.__moderateFixtureInjected).toBeUndefined();
    } finally {
      if (oldMocker) Object.defineProperty(globals, '__moderateFixtureMocker', oldMocker);
      else Reflect.deleteProperty(globals, '__moderateFixtureMocker');
      if (oldFlag) Object.defineProperty(globals, '__moderateFixtureInjected', oldFlag);
      else Reflect.deleteProperty(globals, '__moderateFixtureInjected');
    }
  });

  it.each(['traversal:../outside.js', 'traversal:..\\outside.js'])(
    'rejects redirect metadata outside the file allowlist: %s', async (redirect) => {
      const { interceptorPlugin } = await import(pathToFileURL(require.resolve('@vitest/mocker/node')).href);
      const registry = new MockerRegistry();
      const plugin = interceptorPlugin({ registry });
      const callbacks = new Map<string, (event: unknown) => void>();
      const configure = plugin.configureServer as (server: unknown) => void;
      configure({
        config: { root: '/fixture/root', server: { fs: { strict: true, allow: ['/fixture/root'] } }, fsDenyGlob: () => false, safeModulePaths: new Set() },
        ws: { on: (event: string, callback: (value: unknown) => void) => callbacks.set(event, callback), send: vi.fn() },
      });
      callbacks.get('vitest:interceptor:register')!({ type: 'redirect', raw: '/fixture', id: '/fixture', url: '/fixture', redirect });
      expect(registry.getById('/fixture')).toBeUndefined();
      callbacks.get('vitest:interceptor:register')!({ type: 'redirect', raw: '/control', id: '/control', url: '/control', redirect: 'fixture:allowed.js' });
      expect(registry.getById('/control')?.type).toBe('redirect');
    },
  );
});
