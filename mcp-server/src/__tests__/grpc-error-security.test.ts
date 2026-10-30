import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const grpc = require('@grpc/grpc-js');
const privateDetail = 'internal-fixture-path-and-token';

async function invoke(requestStream: boolean, responseStream: boolean, explicitStatus = false) {
  const server = new grpc.Server();
  const serialize = (value: string) => Buffer.from(value);
  const deserialize = (value: Buffer) => value.toString();
  const path = '/security.Fixture/Check';
  server.addService({ check: { path, requestStream, responseStream, requestSerialize: serialize, requestDeserialize: deserialize, responseSerialize: serialize, responseDeserialize: deserialize } }, {
    check: (_call: unknown, callback: (error: Error) => void) => {
      if (explicitStatus) {
        callback(Object.assign(new Error('public-fixture-denial'), { code: grpc.status.PERMISSION_DENIED, details: 'public-fixture-denial' }));
      } else {
        throw new Error(privateDetail);
      }
    },
  });
  let client: { close(): void } | undefined;
  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error: Error | null, port: number) => error ? reject(error) : resolve(port));
    });
    const channel = new grpc.Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    client = channel;
    return await new Promise<{ code: number; details: string }>((resolve, reject) => {
      const callback = (error: { code: number; details: string } | null) => error ? resolve(error) : reject(new Error('fixture expected a status error'));
      const options = { deadline: Date.now() + 2000 };
      if (!requestStream && !responseStream) {
        channel.makeUnaryRequest(path, serialize, deserialize, 'fixture', options, callback);
      } else if (!requestStream) {
        const call = channel.makeServerStreamRequest(path, serialize, deserialize, 'fixture', options);
        call.on('error', callback);
        call.resume();
      } else if (!responseStream) {
        channel.makeClientStreamRequest(path, serialize, deserialize, options, callback).end('fixture');
      } else {
        const call = channel.makeBidiStreamRequest(path, serialize, deserialize, options);
        call.on('error', callback);
        call.resume();
        call.end('fixture');
      }
    });
  } finally {
    client?.close();
    server.forceShutdown();
  }
}

describe('gRPC unexpected-error disclosure', () => {
  it.each([
    ['unary', false, false], ['server stream', false, true],
    ['client stream', true, false], ['bidirectional stream', true, true],
  ] as const)('redacts unexpected %s handler errors by default', async (_kind, requestStream, responseStream) => {
    expect(process.env.GRPC_NODE_DEBUG_SEND_ERROR_DETAILS).toBeUndefined();
    const error = await invoke(requestStream, responseStream);
    expect(error.code).toBe(grpc.status.UNKNOWN);
    expect(error.details).toBe('Unknown error');
    expect(error.details).not.toContain(privateDetail);
  });
  it('preserves a deliberate application status and public message', async () => {
    const error = await invoke(false, false, true);
    expect(error.code).toBe(grpc.status.PERMISSION_DENIED);
    expect(error.details).toBe('public-fixture-denial');
  });
});
