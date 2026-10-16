import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SessionStore, type StorageLike } from '../../src/core/session.ts';
import { defaultSettings, loadSettings, saveSettings } from '../../src/core/settings.ts';

class Mem implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('session store (privacy)', () => {
  it('round-trips settings through session storage only', () => {
    const mem = new Mem();
    const s = new SessionStore(mem);
    const st = defaultSettings();
    st.units = 'kmh';
    saveSettings(s, st);
    const s2 = new SessionStore(mem);
    expect(loadSettings(s2).units).toBe('kmh');
  });

  it('Reset Session clears everything immediately and notifies listeners', () => {
    const mem = new Mem();
    const s = new SessionStore(mem);
    s.set('best.sf', { timeTrial: 61.2 });
    s.set('settings', { units: 'kmh' });
    let notified = false;
    s.onReset(() => (notified = true));
    s.reset();
    expect(mem.m.size).toBe(0);
    expect(s.get('best.sf', null)).toBeNull();
    expect(notified).toBe(true);
  });

  it('survives corrupt or blocked storage', () => {
    const mem = new Mem();
    mem.setItem('cd.session.v1', '{not json');
    const s = new SessionStore(mem);
    expect(s.get('x', 1)).toBe(1);
    const blocked: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };
    const b = new SessionStore(blocked);
    expect(() => b.set('a', 1)).not.toThrow();
    expect(b.get('a', 0)).toBe(1); // falls back to in-memory state
  });

  it('source never touches localStorage, IndexedDB, cookies or sendBeacon, and fetches same-origin only', () => {
    const files = walk('src').filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
      expect(src, f).not.toMatch(/localStorage|indexedDB|document\.cookie|sendBeacon|navigator\.geolocation/);
      for (const m of src.matchAll(/fetch\(([^)]*)\)/g)) expect(m[1], f).not.toMatch(/https?:\/\//);
    }
  });
});
