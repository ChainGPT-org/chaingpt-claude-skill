/**
 * Tier-2 deploy-tool tests.
 *
 * Validates tool definitions, the mainnet safety gate, and a real solc
 * compilation round-trip. Heavy paths (estimate / build_tx) require a live
 * RPC and are tested in CI only when SMOKE=1 is set in the env.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.CHAINGPT_API_KEY = 'test-key';

import { deployTools, handleDeployTool } from '../tools/deploy.js';

describe('Tier-2 tool definitions', () => {
  it('exposes 5 deploy tools', () => {
    const names = deployTools.map((t) => t.name);
    expect(names).toEqual([
      'chaingpt_deploy_compile',
      'chaingpt_deploy_estimate',
      'chaingpt_deploy_build_tx',
      'chaingpt_deploy_verify',
      'chaingpt_deploy_verify_status',
    ]);
  });

  it('build_tx schema includes the acknowledgeMainnet safety flag', () => {
    const t = deployTools.find((t) => t.name === 'chaingpt_deploy_build_tx')!;
    const props = (t.inputSchema as any).properties;
    expect(props.acknowledgeMainnet).toBeDefined();
    expect(props.acknowledgeMainnet.type).toBe('boolean');
  });

  it('every deploy tool declares object schema and a non-trivial description', () => {
    for (const t of deployTools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.description!.length).toBeGreaterThan(50);
    }
  });

  it('mainnet networks are in the network enum and listed before testnets', () => {
    const t = deployTools.find((t) => t.name === 'chaingpt_deploy_build_tx')!;
    const networkEnum = (t.inputSchema as any).properties.network.enum as string[];
    // Mainnets first (sanity)
    expect(networkEnum[0]).toBe('ethereum');
    expect(networkEnum).toContain('ethereum');
    expect(networkEnum).toContain('base');
    expect(networkEnum).toContain('sepolia');
    expect(networkEnum).toContain('base-sepolia');
  });
});

describe('Tier-2 mainnet safety gate', () => {
  it('refuses chaingpt_deploy_build_tx without acknowledgeMainnet on a mainnet', async () => {
    const result = await handleDeployTool('chaingpt_deploy_build_tx', {
      bytecode: '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2',
      network: 'ethereum',
    });
    expect(result.content[0].text).toContain('Mainnet deploy refused');
    expect(result.content[0].text).toContain('acknowledgeMainnet');
  });

  it('does NOT refuse on a testnet network', async () => {
    // We mock fetch so we don't actually hit Sepolia
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'mocked' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const result = await handleDeployTool('chaingpt_deploy_build_tx', {
      bytecode: '0x6080604052348015',
      network: 'sepolia',
    });
    // Either succeeds or fails with the mocked RPC error — but NEVER the mainnet-refusal copy.
    expect(result.content[0].text).not.toContain('Mainnet deploy refused');
    vi.restoreAllMocks();
  });
});

describe('Tier-2 compile path (real solc)', () => {
  it('compiles a minimal contract and returns bytecode + ABI', async () => {
    const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Hello {
    string public greeting = "hi";
    function setGreeting(string memory g) external { greeting = g; }
}`;
    const result = await handleDeployTool('chaingpt_deploy_compile', { source });
    const text = result.content[0].text;
    expect(text).toContain('Hello');
    expect(text).toContain('Bytecode size:');
    expect(text).toMatch(/0x[0-9a-f]+/);
    expect(text).toContain('abi');
  });

  it('reports compilation errors clearly', async () => {
    const broken = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Broken {
    function bad() external { not_a_real_thing(); }
}`;
    await expect(handleDeployTool('chaingpt_deploy_compile', { source: broken })).rejects.toThrow(/Solidity compilation failed/);
  });
});
