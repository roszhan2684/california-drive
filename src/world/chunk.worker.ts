import { ChunkContext, type ChunkData, type ChunkOptions } from './chunkGen.ts';
import { transferables } from './meshBuilder.ts';
import type { DistrictData } from './types.ts';

let ctx: ChunkContext | null = null;

interface WorkerScope { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent) => void) | null }
const scope = self as unknown as WorkerScope;

type Msg = { type: 'init'; data: DistrictData; opts: ChunkOptions } | { type: 'chunk'; cx: number; cz: number; id: number };

scope.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === 'init') {
    ctx = new ChunkContext(m.data, m.opts);
    scope.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'chunk' && ctx) {
    let data: ChunkData;
    try {
      data = ctx.generate(m.cx, m.cz);
    } catch (e) {
      scope.postMessage({ type: 'error', id: m.id, message: String(e) });
      return;
    }
    const tr: ArrayBuffer[] = [];
    for (const k of ['terrain', 'roads', 'neon', 'decals', 'sidewalks', 'markings', 'buildings', 'roofs', 'structures', 'tunnelLights'] as const) tr.push(...transferables(data[k]));
    for (const c of [data.terrainCollider, data.roadCollider, data.staticCollider]) if (c) tr.push(c.v.buffer as ArrayBuffer, c.i.buffer as ArrayBuffer);
    for (const a of [data.streetlights, data.trees, data.signals, data.stopSigns, data.parked, data.tunnelZones]) tr.push(a.buffer as ArrayBuffer);
    scope.postMessage({ type: 'chunk', id: m.id, data }, tr);
  }
};
