import {
  AdditiveBlending, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, RingGeometry, TorusGeometry, Vector3, type Scene,
} from 'three';
import type { ActivityManager, Marker } from './activities.ts';
import { sampleGhost } from './ghost.ts';
import type { CarRig } from '../vehicle/carModel.ts';

const KIND_COLOR: Record<Marker['kind'], string> = {
  timeTrial: '#ff5a36', scenic: '#4fd1ff', drift: '#ff3fa4', speedTrap: '#ffd23d', parking: '#58f29a', slalom: '#ff9f1c', photo: '#c58cff',
};

function beamMaterial(color: string) {
  const m = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false, fog: true });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = uv.y;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <opaque_fragment>', 'diffuseColor.a *= pow(1.0 - vH, 1.6);\n#include <opaque_fragment>');
  };
  return m;
}

/** World-space visuals for activity markers, checkpoints, cones, parking bay and the ghost car. */
export class ActivityVisuals {
  readonly group = new Group();
  private beams = new Map<string, Object3D>();
  private checkpoint: Group;
  private cones: Mesh[] = [];
  private bay: Mesh;
  private ghost: CarRig;
  private routeLine: Line;
  private time = 0;
  private coneGeo = new ConeGeometry(0.28, 0.75, 12).translate(0, 0.375, 0);
  private coneMat = new MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 });

  constructor(scene: Scene, mgr: ActivityManager, buildGhost: () => CarRig) {
    scene.add(this.group);
    for (const m of mgr.markers) {
      const g = new Group();
      const beam = new Mesh(new CylinderGeometry(m.kind === 'drift' ? 2.2 : 0.9, m.kind === 'drift' ? 2.2 : 0.9, 70, 20, 1, true).translate(0, 35, 0), beamMaterial(KIND_COLOR[m.kind]));
      g.add(beam);
      const ring = new Mesh(new RingGeometry(m.radius * (m.kind === 'drift' ? 0.97 : 0.6), m.radius * (m.kind === 'drift' ? 1 : 0.68), 48).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: new Color(KIND_COLOR[m.kind]).multiplyScalar(1.5), transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      ring.position.y = 0.25;
      g.add(ring);
      g.position.set(m.x, m.y, m.z);
      this.group.add(g);
      this.beams.set(m.id, g);
    }
    this.checkpoint = new Group();
    const arch = new Mesh(new TorusGeometry(7, 0.35, 10, 48, Math.PI), new MeshBasicMaterial({ color: new Color('#ffb347').multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.85 }));
    this.checkpoint.add(arch);
    const cbeam = new Mesh(new CylinderGeometry(2, 2, 90, 20, 1, true).translate(0, 45, 0), beamMaterial('#ffb347'));
    this.checkpoint.add(cbeam);
    this.checkpoint.visible = false;
    this.group.add(this.checkpoint);
    this.bay = new Mesh(new RingGeometry(0.9, 1.0, 4, 1).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2).scale(1.45, 1, 3.4), new MeshBasicMaterial({ color: new Color('#58f29a').multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }));
    this.bay.visible = false;
    this.group.add(this.bay);
    this.ghost = buildGhost();
    this.ghost.setBadges?.(false);
    const gm = new MeshBasicMaterial({ color: new Color('#6fe3ff'), transparent: true, opacity: 0.28, depthWrite: false, blending: AdditiveBlending });
    this.ghost.root.traverse((o) => { if ((o as Mesh).isMesh) { (o as Mesh).material = gm; (o as Mesh).castShadow = false; } });
    this.ghost.spotL.visible = this.ghost.spotR.visible = false;
    this.ghost.root.visible = false;
    this.group.add(this.ghost.root);
    this.routeLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.0 }));
    this.group.add(this.routeLine);
  }

  update(dt: number, mgr: ActivityManager, groundY: (x: number, z: number) => number, player?: { x: number; z: number }) {
    this.time += dt;
    for (const [id, g] of this.beams) {
      const active = mgr.active?.marker.id === id;
      g.visible = !mgr.active || active;
      g.scale.setScalar(1 + Math.sin(this.time * 2) * 0.03);
      if (player) {
        const d = Math.hypot(g.position.x - player.x, g.position.z - player.z);
        const f = Math.max(0, Math.min(1, (d - 14) / 60));
        const beam = g.children[0] as Mesh;
        (beam.material as MeshBasicMaterial).opacity = 0.3 * f;
        beam.visible = f > 0.01;
      }
    }
    const cp = mgr.currentCheckpoint();
    this.checkpoint.visible = !!cp;
    if (cp) {
      this.checkpoint.position.set(cp.x, cp.y, cp.z);
      this.checkpoint.rotation.y = -cp.heading;
    }
    const a = mgr.active;
    this.bay.visible = !!a?.bay;
    if (a?.bay) {
      this.bay.position.set(a.bay.x, groundY(a.bay.x, a.bay.z) + 0.2, a.bay.z);
      this.bay.rotation.y = -a.bay.heading;
    }
    // cones
    const cones = a?.cones ?? [];
    while (this.cones.length < cones.length) {
      const c = new Mesh(this.coneGeo, this.coneMat);
      c.castShadow = true;
      this.group.add(c);
      this.cones.push(c);
    }
    this.cones.forEach((c, i) => {
      const d = cones[i];
      c.visible = !!d;
      if (d) {
        c.position.set(d.x, groundY(d.x, d.z) + 0.1, d.z);
        c.rotation.z = d.hit ? 1.4 : 0;
      }
    });
    // ghost
    const gf = mgr.ghostFrames;
    this.ghost.root.visible = !!gf && !!a;
    if (gf && a) {
      const f = sampleGhost(gf, a.t);
      if (f) {
        this.ghost.root.position.set(f.x, f.y, f.z);
        this.ghost.root.quaternion.set(f.qx, f.qy, f.qz, f.qw);
      }
    }
    void Vector3;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose?.(); }
    });
    this.ghost.dispose();
    this.group.removeFromParent();
  }
}
