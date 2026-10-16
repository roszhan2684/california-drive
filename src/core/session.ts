// Session-only persistence. Gameplay state lives in memory; small settings/progress
// may be mirrored into sessionStorage so a refresh in the same tab keeps them.
// Nothing is written to localStorage, IndexedDB or cookies, and nothing leaves the browser.

const KEY = 'cd.session.v1';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear?(): void;
}

class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

function defaultStorage(): StorageLike {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const t = '__cd_probe__';
      sessionStorage.setItem(t, '1');
      sessionStorage.removeItem(t);
      return sessionStorage;
    }
  } catch {
    // blocked storage (privacy mode / sandbox): fall back to memory
  }
  return new MemoryStorage();
}

export class SessionStore {
  private data: Record<string, unknown> = {};
  private storage: StorageLike;
  private listeners = new Set<() => void>();

  constructor(storage: StorageLike = defaultStorage()) {
    this.storage = storage;
    try {
      const raw = storage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
  }

  get<T>(k: string, fallback: T): T {
    return (k in this.data ? (this.data[k] as T) : fallback);
  }

  set<T>(k: string, v: T) {
    this.data[k] = v;
    this.flush();
  }

  delete(k: string) {
    delete this.data[k];
    this.flush();
  }

  /** Wipe all session data (Reset Session). */
  reset() {
    this.data = {};
    try {
      this.storage.removeItem(KEY);
      // remove any stray keys we may have written in older builds
      if (typeof sessionStorage !== 'undefined' && this.storage === sessionStorage) {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('cd.')) sessionStorage.removeItem(k);
        }
      }
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l();
  }

  onReset(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.data));
  }

  private flush() {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* quota or blocked: keep in memory only */
    }
  }
}
