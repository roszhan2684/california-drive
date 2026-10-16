import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial, Vector3, type Scene } from 'three';

/** Ring-buffer skid mark ribbons, one trail per wheel. */
export class SkidMarks {
  private readonly max: number;
  private geo: BufferGeometry;
  private pos: Float32Array;
  private alpha: Float32Array;
  private next = 0;
  private last: (Vector3 | null)[] = [null, null, null, null];
  private lastR: (Vector3 | null)[] = [null, null, null, null];
  readonly mesh: Mesh;

  constructor(scene: Scene, maxQuads = 3000) {
    this.max = maxQuads;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.alpha = new Float32Array(maxQuads * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    this.geo = new BufferGeometry();
    const pa = new BufferAttribute(this.pos, 3);
    pa.setUsage(DynamicDrawUsage);
    const aa = new BufferAttribute(this.alpha, 1);
    aa.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('alpha', aa);
    this.geo.setIndex(new BufferAttribute(idx, 1));
    const mat = new MeshBasicMaterial({ color: 0x0c0c0c, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10 });
    mat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float alpha;\nvarying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = alpha;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>');
    };
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Add/continue a mark for wheel i at ground point p with lateral direction r; intensity 0 ends the trail. */
  add(i: number, p: Vector3, right: Vector3, intensity: number, width = 0.24) {
    if (intensity <= 0.02) { this.last[i] = null; return; }
    const l = this.last[i];
    const hr = right.clone().multiplyScalar(width / 2);
    const a = p.clone().sub(hr), b = p.clone().add(hr);
    if (!l) { this.last[i] = a; this.lastR[i] = b; return; }
    if (l.distanceToSquared(a) < 0.04) return;
    if (l.distanceToSquared(a) > 4) { this.last[i] = a; this.lastR[i] = b; return; }
    const q = this.next;
    this.next = (this.next + 1) % this.max;
    const o = q * 12;
    const lr = this.lastR[i]!;
    this.pos.set([l.x, l.y + 0.02, l.z, lr.x, lr.y + 0.02, lr.z, a.x, a.y + 0.02, a.z, b.x, b.y + 0.02, b.z], o);
    const al = Math.min(0.85, intensity);
    this.alpha.set([al, al, al, al], q * 4);
    const pa = this.geo.getAttribute('position') as BufferAttribute;
    const aa = this.geo.getAttribute('alpha') as BufferAttribute;
    pa.addUpdateRange(o, 12);
    aa.addUpdateRange(q * 4, 4);
    pa.needsUpdate = true;
    aa.needsUpdate = true;
    this.last[i] = a;
    this.lastR[i] = b;
  }

  clear() {
    this.alpha.fill(0);
    (this.geo.getAttribute('alpha') as BufferAttribute).needsUpdate = true;
    this.last = [null, null, null, null];
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.removeFromParent();
  }
}
