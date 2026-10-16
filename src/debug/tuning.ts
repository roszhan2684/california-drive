import type { VehicleConfig } from '../physics/vehicle/config.ts';
import type { CameraTuning } from '../camera/cameraRig.ts';
import type { PostFX } from '../render/post.ts';

/** Live tuning panel (F4). lil-gui is loaded lazily so it never ships in the critical path. */
export class TuningPanel {
  private gui: any = null;
  private loading = false;

  async toggle(cfg: VehicleConfig, cam: CameraTuning, post: PostFX | null, onChange: () => void) {
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
      return;
    }
    if (this.loading) return;
    this.loading = true;
    const { default: GUI } = await import('lil-gui');
    this.loading = false;
    const gui = new GUI({ title: 'Tuning (F4)', width: 300 });
    gui.domElement.style.zIndex = '20';
    const tire = gui.addFolder('Tires');
    tire.add(cfg.tire, 'mu', 0.6, 1.8, 0.01);
    tire.add(cfg.tire, 'peakSlipRatio', 0.04, 0.25, 0.005);
    tire.add(cfg.tire, 'peakSlipAngle', 0.05, 0.3, 0.005);
    tire.add(cfg.tire, 'shape', 1.1, 1.9, 0.01).name('sliding falloff (C)');
    tire.add(cfg.tire, 'rearLatGrip', 0.7, 1.3, 0.01);
    const sus = gui.addFolder('Suspension');
    for (const k of ['stiffnessFront', 'stiffnessRear'] as const) sus.add(cfg.suspension, k, 15000, 120000, 500);
    for (const k of ['bumpDampFront', 'bumpDampRear', 'reboundDampFront', 'reboundDampRear'] as const) sus.add(cfg.suspension, k, 500, 9000, 50);
    for (const k of ['antiRollFront', 'antiRollRear'] as const) sus.add(cfg.suspension, k, 0, 60000, 500);
    const st = gui.addFolder('Steering');
    st.add(cfg.steering, 'maxAngle', 0.3, 0.8, 0.01);
    st.add(cfg.steering, 'halfLockSpeed', 10, 60, 1);
    st.add(cfg.steering, 'rate', 1, 8, 0.1);
    const pt = gui.addFolder('Powertrain & brakes');
    const scale = { torque: 1 };
    const base = cfg.engine.torqueCurve.map(([r, t]) => [r, t] as [number, number]);
    pt.add(scale, 'torque', 0.5, 1.8, 0.01).name('torque scale').onChange((v: number) => { cfg.engine.torqueCurve = base.map(([r, t]) => [r, t * v]); });
    pt.add(cfg.gearbox, 'final', 2.5, 4.5, 0.01);
    pt.add(cfg.diff, 'lockRatio', 0, 1, 0.01).name('LSD lock');
    pt.add(cfg.brakes, 'maxTorque', 5000, 20000, 100);
    pt.add(cfg.brakes, 'frontBias', 0.4, 0.8, 0.01);
    pt.add(cfg.brakes, 'handbrakeTorque', 1000, 8000, 100);
    pt.add(cfg.aero, 'cdA', 0.4, 1.2, 0.01);
    pt.add(cfg.aero, 'clA', 0, 1.5, 0.01).name('downforce');
    const as = gui.addFolder('Assists');
    as.add(cfg.assists, 'absSlip', 0.05, 0.3, 0.01);
    as.add(cfg.assists, 'tcsSlip', 0.05, 0.3, 0.01);
    as.add(cfg.assists, 'escYawMargin', 0.05, 0.5, 0.01);
    as.add(cfg.assists, 'escGain', 500, 6000, 50);
    as.add(cfg.assists, 'steerAssistGain', 0, 1.2, 0.01);
    const c = gui.addFolder('Camera');
    c.add(cam, 'chaseDistance', 3, 12, 0.1);
    c.add(cam, 'chaseHeight', 0.8, 4, 0.05);
    c.add(cam, 'stiffness', 2, 30, 0.5);
    c.add(cam, 'yawStiffness', 1, 15, 0.1);
    c.add(cam, 'lookAhead', 0, 0.4, 0.01);
    c.add(cam, 'fovKick', 0, 30, 0.5);
    if (post) {
      const g = gui.addFolder('Grade');
      const u = post.grade.uniforms;
      g.add(u.uContrast, 'value', 0.7, 1.5, 0.01).name('contrast');
      g.add(u.uSaturation, 'value', 0, 1.6, 0.01).name('saturation');
      g.add(u.uVignette, 'value', 0, 1, 0.01).name('vignette');
      g.add(post.bloom, 'strength', 0, 1.5, 0.01).name('bloom');
      g.add(post.bloom, 'threshold', 0, 2, 0.01).name('bloom threshold');
    }
    gui.onChange(onChange);
    gui.close();
    gui.open();
    this.gui = gui;
  }

  dispose() {
    this.gui?.destroy();
    this.gui = null;
  }
}
