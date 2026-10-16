// No-paid-dependency guardrail: every installed package must carry an approved open-source license.
// Usage: node --experimental-strip-types tools/check-licenses.ts
import { readFileSync, existsSync } from 'node:fs';

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'CC0-1.0', 'BlueOak-1.0.0', 'Unlicense', 'CC-BY-4.0', 'Python-2.0', 'MPL-2.0', 'Zlib']);
// Packages allowed in devDependencies only (never shipped to players).
const DEV_ONLY_EXTRA = new Set(['MPL-2.0']);

interface LockPkg { version?: string; license?: string; dev?: boolean; devOptional?: boolean; optional?: boolean }
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockPkg> };

function licenseOf(path: string, entry: LockPkg): string {
  if (entry.license) return entry.license;
  const pj = `${path}/package.json`;
  if (existsSync(pj)) {
    const p = JSON.parse(readFileSync(pj, 'utf8'));
    if (typeof p.license === 'string') return p.license;
    if (p.license?.type) return p.license.type;
    if (Array.isArray(p.licenses)) return p.licenses.map((l: any) => l.type ?? l).join(' OR ');
  }
  return 'UNKNOWN';
}

function ok(expr: string, dev: boolean): boolean {
  const parts = expr.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
  const isOr = /\sOR\s/.test(expr);
  const test = (l: string) => ALLOWED.has(l.trim()) && (dev || !DEV_ONLY_EXTRA.has(l.trim()));
  return isOr ? parts.some(test) : parts.every(test);
}

const problems: string[] = [];
const runtime: string[] = [];
let count = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  count++;
  const dev = !!(entry.dev || entry.devOptional);
  const lic = licenseOf(path, entry);
  if (!ok(lic, dev)) problems.push(`${path.replace(/^node_modules\//, '')}@${entry.version} — ${lic}${dev ? ' (dev)' : ''}`);
  if (!dev) runtime.push(`${path.replace(/^node_modules\//, '')}@${entry.version} (${lic})`);
}
console.log(`checked ${count} packages; runtime: ${runtime.join(', ')}`);
if (problems.length) {
  console.error('License guardrail FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('License guardrail passed: all dependencies are free/open-source licensed.');
