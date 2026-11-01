import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './_setup.js';

process.env.CHAINGPT_DASHBOARD_DIR = mkdtempSync(join(tmpdir(), 'cgpt-dashboard-test-'));
const { handleDashboardTool } = await import('../tools/dashboard.js');

const PORT = 19_000 + Math.floor(Math.random() * 2_000);
const base = `http://127.0.0.1:${PORT}`;
const serve = async () => /Admin token:\s+(\S+)/.exec((await handleDashboardTool('chaingpt_dashboard_serve', { port: PORT })).content[0].text)![1];
const login = async (token: string) => {
  const r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: `token=${token}` });
  return /cg_dash_sid=([a-f0-9]+)/.exec(r.headers.get('set-cookie') ?? '')![1];
};
const page = async (sid: string) => (await fetch(`${base}/`, { headers: { cookie: `cg_dash_sid=${sid}` } })).text();

describe('read-only dashboard sessions', () => {
  it('rotating the admin token ends sessions opened with the old token', async () => {
    const sid = await login(await serve());
    expect(await page(sid)).not.toContain('Paste admin token');
    await serve(); // rotate on the same port
    expect(await page(sid)).toContain('Paste admin token'); // back to the login page
  });

  it('logout requires a same-origin request', async () => {
    const sid = await login(await serve());
    const r = await fetch(`${base}/logout`, { method: 'POST', headers: { cookie: `cg_dash_sid=${sid}`, origin: 'http://evil.example' } });
    expect(r.status).toBe(403);
  });
});
