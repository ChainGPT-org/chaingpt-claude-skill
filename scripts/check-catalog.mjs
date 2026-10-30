#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = 'mcp-server/src/tools';
const toolsByModule = Object.fromEntries(readdirSync(directory).filter(f => f.endsWith('.ts')).sort().map(f => [f.replace('.ts',''), [...readFileSync(join(directory, f), 'utf8').matchAll(/name: '(chaingpt_[^']+)'/g)].map(m => m[1])]));
const names = Object.values(toolsByModule).flat();
if (new Set(names).size !== names.length) throw new Error('Duplicate tool names');
const catalog = {
  tools: names.length,
  skills: readdirSync('skills').filter(f => { try { return readFileSync(`skills/${f}/SKILL.md`, 'utf8').startsWith('---'); } catch { return false; } }).length,
  templates: readdirSync('templates').filter(f => f.endsWith('.md')).length,
  solidityBlocks: readdirSync('patterns').filter(f => f.endsWith('.md')).reduce((n, f) => n + [...readFileSync(`patterns/${f}`, 'utf8').matchAll(/^```solidity\s*$/gm)].length, 0),
  toolsByModule,
};
const path = 'docs/catalog.json';
if (process.argv.includes('--write')) writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
else if (JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !== JSON.stringify(catalog)) throw new Error('Catalog stale: node scripts/check-catalog.mjs --write');
const readme = readFileSync('README.md', 'utf8');
if (!readme.includes(`MCP_tools-${catalog.tools}-`) || !readme.includes(`## 🔌 MCP Server — ${catalog.tools} Tools`)) throw new Error('README tool count disagrees with the generated catalog.');
const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json','utf8'));
if (!marketplace.description.includes(`${catalog.tools} MCP tools`)) throw new Error('Marketplace count stale.');
console.log(`Catalog OK: ${catalog.tools} tools, ${catalog.skills} skills, ${catalog.templates} template files, ${catalog.solidityBlocks} Solidity blocks`);
