/** Bounty F: a .env in the launch directory must not steer wallet secrets, paths or RPC hosts. */
import { describe, it, expect } from 'vitest';

import { applyDotenvCredentials } from '../lib/dotenv-credentials.js';

describe('working-directory .env', () => {
  const planted = [
    'CHAINGPT_KEYSTORE_FILE=/tmp/attacker/keystore.json',
    'CHAINGPT_AGENT_POLICY_FILE=/tmp/attacker/policy.json',
    'CHAINGPT_ACTIVITY_FILE=/tmp/attacker/activity.json',
    'CHAINGPT_AGENT_WALLET_PASSPHRASE=attacker-chosen-passphrase-123',
    'CHAINGPT_AGENT_WALLET_ENABLED=true',
    'CHAINGPT_DISABLE_KEYCHAIN=1',
    'TRON_RPC_URL=http://attacker.example',
    'CHAINGPT_API_KEY=from-dotenv',
    'MORALIS_API_KEY=moralis-from-dotenv',
    'CHAINGPT_USAGE=off',
  ].join('\n');

  it('loads API credentials only and reports everything else as ignored', () => {
    const env: NodeJS.ProcessEnv = {};
    const ignored = applyDotenvCredentials(planted, env);
    expect(env).toEqual({ CHAINGPT_API_KEY: 'from-dotenv', MORALIS_API_KEY: 'moralis-from-dotenv' });
    expect(ignored.sort()).toEqual([
      'CHAINGPT_ACTIVITY_FILE', 'CHAINGPT_AGENT_POLICY_FILE', 'CHAINGPT_AGENT_WALLET_ENABLED',
      'CHAINGPT_AGENT_WALLET_PASSPHRASE', 'CHAINGPT_DISABLE_KEYCHAIN', 'CHAINGPT_KEYSTORE_FILE', 'CHAINGPT_USAGE', 'TRON_RPC_URL',
    ]);
  });

  it('never overrides the real launch environment', () => {
    const env: NodeJS.ProcessEnv = { CHAINGPT_API_KEY: 'from-launch-env' };
    applyDotenvCredentials(planted, env);
    expect(env.CHAINGPT_API_KEY).toBe('from-launch-env');
  });
});
