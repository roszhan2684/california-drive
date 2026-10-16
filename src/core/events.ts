/** Minimal typed event bus. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: any) => void>>();

  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let set = this.map.get(k);
    if (!set) this.map.set(k, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof E>(k: K, p: E[K]) {
    const set = this.map.get(k);
    if (set) for (const fn of [...set]) fn(p);
  }

  clear() {
    this.map.clear();
  }
}

export interface GameEvents extends Record<string, unknown> {
  toast: { title: string; sub?: string; kind?: 'street' | 'district' | 'activity' | 'info' | 'discovery' };
  shift: { gear: number; up: boolean };
  impact: { strength: number; x: number; y: number; z: number };
  activity: { id: string; state: 'start' | 'checkpoint' | 'finish' | 'fail' | 'cancel'; detail?: string };
  settings: void;
}
