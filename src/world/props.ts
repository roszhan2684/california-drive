import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, BoxGeometry, DodecahedronGeometry, IcosahedronGeometry, InstancedMesh,
  Matrix4, PlaneGeometry, Quaternion, Vector3, type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Materials } from '../render/materials.ts';
import { parkedVariantIndex, parkedVariants, TRAFFIC_COLORS } from '../vehicle/trafficModels.ts';
import { contactShadowGeometry, lampBeamGeometry } from '../vfx/atmosphere.ts';

function tint(g: BufferGeometry, r: number, gg: number, b: number) {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, gg, b], i * 3);
  g.setAttribute('color', new BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

export interface PropGeometries {
  pole: BufferGeometry;
  lampHead: BufferGeometry;
  lightPool: BufferGeometry;
  treeTrunk: BufferGeometry[];
  treeCrown: BufferGeometry[];
  signalPole: BufferGeometry;
  signalHead: BufferGeometry;
  signalLamp: BufferGeometry;
  stopSign: BufferGeometry;
  lampBeam: BufferGeometry;
  carShadow: BufferGeometry;
  treeShadow: BufferGeometry;
}

let geos: PropGeometries | null = null;
export function propGeometries(): PropGeometries {
  if (geos) return geos;
  // streetlight: pole along +y, arm toward local -z
  const pole = mergeGeometries([
    new CylinderGeometry(0.07, 0.11, 8.5, 8).translate(0, 4.25, 0),
    new CylinderGeometry(0.05, 0.05, 2.6, 6).rotateX(Math.PI / 2).translate(0, 8.3, -1.3),
  ])!;
  const lampHead = new BoxGeometry(0.32, 0.14, 0.7).translate(0, 8.22, -2.5);
  const lightPool = new PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(0, 0.12, -3.2);
  // trees: 0 broadleaf, 1 conifer, 2 palm (crowns tinted via vertex colors; instance color varies)
  const broadTrunk = new CylinderGeometry(0.14, 0.22, 3.2, 6).translate(0, 1.6, 0);
  const broadCrown = mergeGeometries([
    tint(new IcosahedronGeometry(2.3, 1).translate(0, 4.6, 0).toNonIndexed(), 0.2, 0.33, 0.14),
    tint(new IcosahedronGeometry(1.7, 1).translate(1.1, 4.0, 0.5).toNonIndexed(), 0.24, 0.36, 0.15),
    tint(new IcosahedronGeometry(1.6, 1).translate(-1.0, 4.2, -0.6).toNonIndexed(), 0.18, 0.3, 0.13),
  ])!;
  const conTrunk = new CylinderGeometry(0.16, 0.28, 3, 6).translate(0, 1.5, 0);
  const conCrown = mergeGeometries([
    tint(new ConeGeometry(2.6, 5.5, 8).translate(0, 4.6, 0).toNonIndexed(), 0.1, 0.22, 0.12),
    tint(new ConeGeometry(2.0, 4.6, 8).translate(0, 7.3, 0).toNonIndexed(), 0.11, 0.24, 0.13),
    tint(new ConeGeometry(1.3, 3.6, 8).translate(0, 9.8, 0).toNonIndexed(), 0.12, 0.26, 0.14),
  ])!;
  const palmTrunk = new CylinderGeometry(0.16, 0.24, 11, 6).translate(0, 5.5, 0);
  const fronds: BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const f = new DodecahedronGeometry(1, 0).scale(0.35, 0.12, 2.4).translate(0, 0, 2.0).rotateX(0.45).rotateY((k / 8) * Math.PI * 2).translate(0, 11, 0).toNonIndexed();
    fronds.push(tint(f, 0.2, 0.34, 0.12));
  }
  const palmCrown = mergeGeometries(fronds)!;
  // traffic signal: pole + mast arm along local +x (toward the road), head facing +z
  const signalPole = mergeGeometries([
    new CylinderGeometry(0.1, 0.13, 5.6, 8).translate(0, 2.8, 0),
    new CylinderGeometry(0.06, 0.06, 4.5, 6).rotateZ(Math.PI / 2).translate(-2.25, 5.5, 0),
  ])!;
  const signalHead = mergeGeometries([
    new BoxGeometry(0.42, 1.15, 0.3).translate(-3.6, 4.85, 0.05),
    new BoxGeometry(0.42, 1.15, 0.3).translate(0, 2.9, 0.18),
  ])!;
  const signalLamp = mergeGeometries([
    new CylinderGeometry(0.13, 0.13, 0.05, 12).rotateX(Math.PI / 2).translate(-3.6, 0, 0.22),
    new CylinderGeometry(0.13, 0.13, 0.05, 12).rotateX(Math.PI / 2).translate(0, -1.95, 0.35),
  ])!;
  const stopSign = mergeGeometries([
    tint(new CylinderGeometry(0.04, 0.04, 2.6, 6).translate(0, 1.3, 0).toNonIndexed(), 0.5, 0.5, 0.5),
    tint(new CylinderGeometry(0.38, 0.38, 0.03, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 2.45, 0.03).toNonIndexed(), 0.7, 0.04, 0.03),
  ])!;
  geos = {
    pole, lampHead, lightPool,
    treeTrunk: [broadTrunk, conTrunk, palmTrunk],
    treeCrown: [broadCrown, conCrown, palmCrown],
    signalPole, signalHead, signalLamp, stopSign,
    lampBeam: lampBeamGeometry(8.2, 3.6).translate(0, 8.15, -2.5),
    carShadow: contactShadowGeometry(2.3, 5.4),
    treeShadow: contactShadowGeometry(4.2, 4.2),
  };
  return geos;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _axis = new Vector3(0, 1, 0);

function instanced(geo: BufferGeometry, mat: Material, n: number, cast = false) {
  const im = new InstancedMesh(geo, mat, n);
  im.castShadow = cast;
  im.receiveShadow = true;
  return im;
}

/** Signal lamp handle for traffic light coloring. */
export interface SignalLampRef { mesh: InstancedMesh; index: number; node: number; edge: number }

export interface ChunkProps {
  meshes: InstancedMesh[];
  signals: SignalLampRef[];
  parked: { x: number; y: number; z: number; yaw: number; pitch: number; variant: number }[];
}

export function buildChunkProps(mats: Materials, d: {
  streetlights: Float32Array; trees: Float32Array; signals: Float32Array; stopSigns: Float32Array; parked: Float32Array;
}, shadows: boolean): ChunkProps {
  const g = propGeometries();
  const meshes: InstancedMesh[] = [];
  const signals: SignalLampRef[] = [];
  // streetlights
  const nl = d.streetlights.length / 4;
  if (nl) {
    const poles = instanced(g.pole, mats.pole, nl, shadows);
    const heads = instanced(g.lampHead, mats.lampHead, nl);
    const pools = instanced(g.lightPool, mats.lightPool, nl);
    pools.receiveShadow = false;
    const beams = instanced(g.lampBeam, mats.lampBeam, nl);
    beams.receiveShadow = false;
    beams.userData.noAO = true;
    beams.renderOrder = 6;
    for (let i = 0; i < nl; i++) {
      const [x, y, z, h] = d.streetlights.subarray(i * 4, i * 4 + 4);
      _q.setFromAxisAngle(_axis, -h);
      _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
      poles.setMatrixAt(i, _m); heads.setMatrixAt(i, _m); pools.setMatrixAt(i, _m); beams.setMatrixAt(i, _m);
    }
    meshes.push(poles, heads, pools, beams);
  }
  // trees by type
  const nt = d.trees.length / 6;
  if (nt) {
    for (let type = 0; type < 3; type++) {
      const idx: number[] = [];
      for (let i = 0; i < nt; i++) if (d.trees[i * 6 + 5] === type) idx.push(i);
      if (!idx.length) continue;
      const trunk = instanced(g.treeTrunk[type], mats.bark, idx.length, shadows);
      const blobs = instanced(g.treeShadow, mats.contactShadow, idx.length);
      blobs.userData.noAO = true;
      blobs.receiveShadow = false;
      const crown = instanced(g.treeCrown[type], mats.foliage, idx.length, shadows);
      const c = new Color();
      idx.forEach((i, k) => {
        const [x, y, z, s, r] = d.trees.subarray(i * 6, i * 6 + 5);
        _q.setFromAxisAngle(_axis, r);
        _m.compose(_p.set(x, y - 0.1, z), _q, _s.set(s, s * (0.9 + (r % 0.2)), s));
        trunk.setMatrixAt(k, _m); crown.setMatrixAt(k, _m);
        _m.compose(_p.set(x, y + 0.06, z), _q, _s.set(s * (type === 2 ? 0.8 : 1.2), 1, s * (type === 2 ? 0.8 : 1.2)));
        blobs.setMatrixAt(k, _m);
        const v = 0.85 + ((r * 7.3) % 0.3);
        crown.setColorAt(k, c.setRGB(v, v * (0.95 + (s % 0.1)), v * 0.9));
      });
      meshes.push(trunk, crown, blobs);
    }
  }
  // signals
  const ns = d.signals.length / 6;
  if (ns) {
    const poles = instanced(g.signalPole, mats.pole, ns, shadows);
    const heads = instanced(g.signalHead, mats.signalHead, ns);
    const lamps = instanced(g.signalLamp, mats.signalLamp, ns);
    const c = new Color(0xff2a1a);
    for (let i = 0; i < ns; i++) {
      const [x, y, z, yaw, node, edge] = d.signals.subarray(i * 6, i * 6 + 6);
      // pole stands at the curb; the mast arm reaches over the lanes (local -x after facing +z)
      _q.setFromAxisAngle(_axis, yaw);
      _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
      poles.setMatrixAt(i, _m); heads.setMatrixAt(i, _m);
      lamps.setMatrixAt(i, _m.clone().multiply(new Matrix4().makeTranslation(0, 5.2, 0)));
      lamps.setColorAt(i, c);
      signals.push({ mesh: lamps, index: i, node, edge });
    }
    meshes.push(poles, heads, lamps);
  }
  const nss = d.stopSigns.length / 4;
  if (nss) {
    const signs = instanced(g.stopSign, mats.sign, nss);
    for (let i = 0; i < nss; i++) {
      const [x, y, z, yaw] = d.stopSigns.subarray(i * 4, i * 4 + 4);
      _q.setFromAxisAngle(_axis, yaw);
      _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
      signs.setMatrixAt(i, _m);
    }
    meshes.push(signs);
  }
  // parked cars
  const np = d.parked.length / 7;
  const parked: ChunkProps['parked'] = [];
  if (np) {
    const vars = parkedVariants();
    const shadows2 = instanced(g.carShadow, mats.contactShadow, np);
    shadows2.receiveShadow = false;
    shadows2.userData.noAO = true;
    const byVar: number[][] = vars.map(() => []);
    for (let i = 0; i < np; i++) byVar[parkedVariantIndex(d.parked[i * 7 + 5], vars.length)].push(i);
    const c = new Color();
    byVar.forEach((list, vi) => {
      if (!list.length) return;
      const body = instanced(vars[vi].body, mats.parkedBody, list.length, shadows);
      list.forEach((i, k) => {
        const [x, y, z, h, pitch, , col] = d.parked.subarray(i * 7, i * 7 + 7);
        _q.setFromAxisAngle(_axis, -h).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
        _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
        body.setMatrixAt(k, _m);
        body.setColorAt(k, vars[vi].tint === false ? c.setRGB(1, 1, 1) : c.set(TRAFFIC_COLORS[col % TRAFFIC_COLORS.length]));
        parked.push({ x, y, z, yaw: -h, pitch, variant: vi });
        _m.compose(_p.set(x, y + 0.04, z), _q, _s.set(1, 1, 1));
        shadows2.setMatrixAt(parked.length - 1, _m);
      });
      meshes.push(body);
    });
    meshes.push(shadows2);
  }
  for (const m of meshes) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }
  return { meshes, signals, parked };
}

export function setSignalColor(ref: SignalLampRef, state: 0 | 1 | 2, scratch = new Color()) {
  // 0 green, 1 yellow, 2 red; also shift the lamp to the right slot
  const col = state === 0 ? scratch.setRGB(0.15, 2.4, 0.9) : state === 1 ? scratch.setRGB(2.6, 1.6, 0.1) : scratch.setRGB(2.8, 0.2, 0.12);
  ref.mesh.setColorAt(ref.index, col);
  const m = new Matrix4();
  ref.mesh.getMatrixAt(ref.index, m);
  const pos = new Vector3(), quat = new Quaternion(), sc = new Vector3();
  m.decompose(pos, quat, sc);
  const base = (ref as any)._baseY ?? ((ref as any)._baseY = pos.y - 5.2);
  pos.y = base + (state === 2 ? 5.2 : state === 1 ? 4.85 : 4.5);
  m.compose(pos, quat, sc);
  ref.mesh.setMatrixAt(ref.index, m);
  ref.mesh.instanceMatrix.needsUpdate = true;
  if (ref.mesh.instanceColor) ref.mesh.instanceColor.needsUpdate = true;
}
