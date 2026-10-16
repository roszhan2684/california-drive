// Combined-slip tire model using the similarity method with a normalized
// magic-formula curve: f(s) = sin(C * atan(B s)), with B chosen so the peak is at s = 1.

export interface TireParams {
  mu: number;
  peakSlipRatio: number;
  peakSlipAngle: number;
  shape: number;
}

export function curveB(shape: number): number {
  return Math.tan(Math.PI / (2 * shape));
}

/** Normalized force (0..1) for a normalized combined slip s >= 0. */
export function tireCurve(s: number, shape: number, B = curveB(shape)): number {
  return Math.sin(shape * Math.atan(B * s));
}

export interface TireForce {
  fx: number;
  fy: number;
  /** Normalized combined slip (1 = peak). */
  slip: number;
}

/**
 * @param slipRatio longitudinal slip ratio (positive when spinning faster than the road)
 * @param slipAngle lateral slip angle in radians (positive when the contact patch slides to +lateral)
 * @param load normal load (N)
 * @param grip surface/weather multiplier
 * @param latScale extra lateral grip multiplier
 */
export function tireForce(p: TireParams, slipRatio: number, slipAngle: number, load: number, grip: number, latScale = 1, out: TireForce = { fx: 0, fy: 0, slip: 0 }): TireForce {
  const sx = slipRatio / p.peakSlipRatio;
  const sy = Math.tan(slipAngle) / Math.tan(p.peakSlipAngle);
  const s = Math.hypot(sx, sy);
  if (s < 1e-6 || load <= 0) {
    out.fx = 0; out.fy = 0; out.slip = 0;
    return out;
  }
  const f = tireCurve(s, p.shape) * p.mu * grip * load;
  out.fx = (f * sx) / s;
  out.fy = (-f * sy * latScale) / s;
  out.slip = s;
  return out;
}
