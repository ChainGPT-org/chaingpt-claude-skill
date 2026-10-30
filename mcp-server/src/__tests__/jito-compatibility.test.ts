import { createServer } from 'node:http';
import { createPublicKey, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { AddressLookupTableAccount, Keypair, SystemInstruction, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

const require = createRequire(import.meta.url);
const pythRequire = createRequire(require.resolve('@pythnetwork/solana-utils'));
const jitoRequire = createRequire(pythRequire.resolve('jito-ts'));
const blockhash = '11111111111111111111111111111111';
// Disposable local fixtures only; no funded accounts or external endpoints.
const payer = Keypair.fromSeed(new Uint8Array(32).fill(1));
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const payerVerificationKey = createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), payer.publicKey.toBuffer()]),
  format: 'der', type: 'spki',
});

function transaction(format = 'v0') {
  const message = new TransactionMessage({
    payerKey: payer.publicKey, recentBlockhash: blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 7 })],
  });
  const lookup = new AddressLookupTableAccount({
    key: Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey,
    state: { deactivationSlot: (1n << 64n) - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [recipient] },
  });
  const tx = new VersionedTransaction(format === 'legacy' ? message.compileToLegacyMessage() : message.compileToV0Message(format === 'v0-lookup' ? [lookup] : []));
  tx.sign([payer]);
  return tx;
}

describe('Jito compatibility through the Pyth consumer path', () => {
  it('imports both public SDKs and confines the compatibility pins to Jito', () => {
    const jito = pythRequire('jito-ts');
    expect(jito.bundle.Bundle).toBeTypeOf('function');
    expect(jito.searcher.SearcherClient).toBeTypeOf('function');
    expect(require('@pythnetwork/solana-utils').sendTransactionsJito).toBeTypeOf('function');
    const solanaRequire = createRequire(jitoRequire.resolve('@solana/web3.js'));
    expect(jitoRequire('@solana/web3.js/package.json').version).toBe('1.91.9');
    expect(solanaRequire('rpc-websockets/package.json').version).toBe('7.11.2');
    expect(require('@solana/web3.js/package.json').version).toBe('1.99.0');
  });

  it.each(['legacy', 'v0', 'v0-lookup'])('round-trips %s transaction packets without altering signed bytes', format => {
    const { Bundle } = jitoRequire('./sdk/block-engine/types');
    const { deserializeTransactions } = jitoRequire('./sdk/block-engine/utils');
    const tx = transaction(format);
    const bundle = new Bundle([tx], 2);
    expect(Buffer.from(bundle.packets[0].data)).toEqual(Buffer.from(tx.serialize()));
    expect(bundle.packets[0].meta.size).toBe(tx.serialize().length);
    expect(Buffer.from(deserializeTransactions(bundle.packets)[0].serialize())).toEqual(Buffer.from(tx.serialize()));
    if (format === 'v0-lookup') expect(tx.message.addressTableLookups).toHaveLength(1);
  });

  it('builds a signed tip with the intended recipient, amount and blockhash', () => {
    const { Bundle } = jitoRequire('./sdk/block-engine/types');
    const bundle = new Bundle([transaction()], 2);
    expect(bundle.addTipTx(payer, 5000, recipient, blockhash)).toBe(bundle);
    const tip = VersionedTransaction.deserialize(bundle.packets[1].data);
    const message = TransactionMessage.decompile(tip.message);
    expect(message.recentBlockhash).toBe(blockhash);
    expect(SystemInstruction.decodeTransfer(message.instructions[0])).toEqual({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 5000n });
    expect(verify(null, tip.message.serialize(), payerVerificationKey, tip.signatures[0])).toBe(true);
  });

  it('preserves bundle size limits for transactions and tips', () => {
    const { Bundle } = jitoRequire('./sdk/block-engine/types');
    const bundle = new Bundle([transaction()], 1);
    expect(bundle.addTransactions(transaction())).toBeInstanceOf(Error);
    expect(bundle.addTipTx(payer, 5000, recipient, blockhash)).toBeInstanceOf(Error);
    expect(bundle.packets).toHaveLength(1);
  });

  it('signs and serializes the Pyth helper bundle through the Jito request codec', async () => {
    const { sendTransactionsJito } = require('@pythnetwork/solana-utils');
    const { SearcherClient } = jitoRequire('./sdk/block-engine/searcher');
    const { SearcherServiceService } = jitoRequire('./gen/block-engine/searcher');
    const tx = transaction();
    // Start unsigned so a no-op wallet cannot satisfy the helper's signing contract.
    tx.signatures[0].fill(0);
    const expected = VersionedTransaction.deserialize(tx.serialize());
    expected.sign([payer]);
    const send = vi.fn((request, callback) => {
      const codec = SearcherServiceService.sendBundle;
      const decoded = codec.requestDeserialize(codec.requestSerialize(request));
      expect(Buffer.from(decoded.bundle.packets[0].data)).toEqual(Buffer.from(expected.serialize()));
      const submitted = VersionedTransaction.deserialize(decoded.bundle.packets[0].data);
      expect(verify(null, submitted.message.serialize(), payerVerificationKey, submitted.signatures[0])).toBe(true);
      callback(null, { uuid: 'fixture-bundle-id' });
    });
    const wallet = { signTransaction: vi.fn(async (input: VersionedTransaction) => {
      const signed = VersionedTransaction.deserialize(input.serialize());
      signed.sign([payer]);
      return signed;
    }) };
    const signature = await sendTransactionsJito([{ tx }], new SearcherClient({ sendBundle: send }), wallet);
    expect(signature).toBe(require('bs58').encode(expected.signatures[0]));
    expect(tx.signatures[0].every(byte => byte === 0)).toBe(true);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not submit a bundle when the Pyth wallet refuses to sign', async () => {
    const { sendTransactionsJito } = require('@pythnetwork/solana-utils');
    const sendBundle = vi.fn();
    const wallet = { signTransaction: vi.fn().mockRejectedValue(new Error('fixture signing refused')) };
    await expect(sendTransactionsJito([{ tx: transaction() }], { sendBundle }, wallet)).rejects.toThrow('fixture signing refused');
    expect(sendBundle).not.toHaveBeenCalled();
  });

  it('propagates Jito submission errors without silently resubmitting', async () => {
    const { sendTransactionsJito } = require('@pythnetwork/solana-utils');
    const { SearcherClient } = jitoRequire('./sdk/block-engine/searcher');
    const send = vi.fn((_request, callback) => callback(new Error('fixture submission rejected')));
    const wallet = { signTransaction: vi.fn(async (tx: VersionedTransaction) => tx) };
    await expect(sendTransactionsJito([{ tx: transaction() }], new SearcherClient({ sendBundle: send }), wallet)).rejects.toThrow('fixture submission rejected');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'error'])('preserves Jito bundle simulation responses (%s)', async outcome => {
    const { JitoRpcConnection } = jitoRequire('./sdk/rpc/connection');
    const { SendTransactionError } = jitoRequire('@solana/web3.js');
    const tx = transaction();
    const logs = ['fixture program: simulation rejected'];
    const result = { context: { slot: 7 }, value: { summary: 'succeeded', transactionResults: [{ err: null, logs: [] }] } };
    const fetch = vi.fn(async (_url: unknown, options: { body: string }) => {
      const request = JSON.parse(options.body);
      expect(request.method).toBe('simulateBundle');
      expect(request.params).toEqual([{ encodedTransactions: [Buffer.from(tx.serialize()).toString('base64')] }, { transactionEncoding: 'base64' }]);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(outcome === 'success' ? { result } : { error: { code: -32002, message: 'fixture simulation rejected', data: { logs } } }) }), { headers: { 'content-type': 'application/json' } });
    });
    const connection = new JitoRpcConnection('http://127.0.0.1:8899', { fetch, httpAgent: false });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      if (outcome === 'success') {
        expect(await connection.simulateBundle([tx])).toEqual(result);
      } else {
        const error = await connection.simulateBundle([tx]).then(() => undefined, (caught: unknown) => caught);
        expect(error).toBeInstanceOf(SendTransactionError);
        expect(error.message).toBe('failed to simulate bundle: fixture simulation rejected');
        expect(error.logs).toEqual(logs);
      }
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { consoleError.mockRestore(); }
  });

  it('supports Solana WebSocket subscriptions through the same Jito dependency', async () => {
    const { Connection } = jitoRequire('@solana/web3.js');
    const { WebSocketServer } = require('ws');
    const server = createServer();
    const sockets = new WebSocketServer({ server });
    const methods: string[] = [];
    sockets.on('connection', (socket: any) => socket.on('message', (bytes: Buffer) => {
      const request = JSON.parse(bytes.toString());
      methods.push(request.method);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'slotSubscribe' ? 42 : true }));
      if (request.method === 'slotSubscribe') socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'slotNotification', params: { subscription: 42, result: { parent: 6, slot: 7, root: 5 } } }));
    }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const connection = new Connection(`http://127.0.0.1:${port}`, { wsEndpoint: `ws://127.0.0.1:${port}` });
    let subscription: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const notification = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Local subscription fixture timed out')), 2000);
        subscription = connection.onSlotChange(resolve);
      });
      await expect(notification).resolves.toEqual({ parent: 6, slot: 7, root: 5 });
      await connection.removeSlotChangeListener(subscription!);
      subscription = undefined;
      expect(methods).toEqual(['slotSubscribe', 'slotUnsubscribe']);
    } finally {
      clearTimeout(timer);
      if (subscription !== undefined) await connection.removeSlotChangeListener(subscription);
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
