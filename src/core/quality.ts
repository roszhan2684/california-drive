export type QualityPreset = 'low' | 'medium' | 'high' | 'cinematic';

export interface QualityProfile {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowExtent: number;
  bloom: boolean;
  smaa: boolean;
  speedBlur: boolean;
  chunkRadius: number;
  trafficCap: number;
  smokeParticles: number;
  rainDrops: number;
  envMapSize: number;
  drawDistance: number;
  treeDensity: number;
  headlightShadows: boolean;
  /** Screen-space ground-truth AO. */
  ao: boolean;
  /** Real point lights assigned to the nearest street lamps at night. */
  pointLights: number;
  /** Ambient pedestrian cap (urban districts). */
  pedestrians: number;
}

export const QUALITY: Record<QualityPreset, QualityProfile> = {
  low: { pixelRatioCap: 0.75, shadows: false, shadowMapSize: 1024, shadowExtent: 60, bloom: false, smaa: false, speedBlur: false, chunkRadius: 1, trafficCap: 8, smokeParticles: 300, rainDrops: 2000, envMapSize: 128, drawDistance: 700, treeDensity: 0.4, headlightShadows: false, ao: false, pointLights: 0, pedestrians: 10 },
  medium: { pixelRatioCap: 1, shadows: true, shadowMapSize: 2048, shadowExtent: 80, bloom: true, smaa: false, speedBlur: false, chunkRadius: 2, trafficCap: 18, smokeParticles: 800, rainDrops: 6000, envMapSize: 256, drawDistance: 1000, treeDensity: 0.7, headlightShadows: false, ao: true, pointLights: 4, pedestrians: 24 },
  high: { pixelRatioCap: 1.5, shadows: true, shadowMapSize: 2048, shadowExtent: 110, bloom: true, smaa: true, speedBlur: true, chunkRadius: 2, trafficCap: 28, smokeParticles: 1500, rainDrops: 10000, envMapSize: 256, drawDistance: 1300, treeDensity: 1, headlightShadows: false, ao: true, pointLights: 6, pedestrians: 40 },
  cinematic: { pixelRatioCap: 2, shadows: true, shadowMapSize: 4096, shadowExtent: 140, bloom: true, smaa: true, speedBlur: true, chunkRadius: 3, trafficCap: 40, smokeParticles: 2000, rainDrops: 16000, envMapSize: 512, drawDistance: 1800, treeDensity: 1, headlightShadows: true, ao: true, pointLights: 10, pedestrians: 60 },
};

/** Watches frame time and suggests lighter settings when the frame budget is exceeded. */
export class QualityGovernor {
  private samples: number[] = [];
  private window = 0;
  scale = 1;
  enabled = true;

  /** Returns a new dynamic resolution scale when it changed, else null. */
  sample(frameMs: number, dt: number): number | null {
    if (!this.enabled) return null;
    this.samples.push(frameMs);
    this.window += dt;
    if (this.window < 3) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    this.samples = [];
    this.window = 0;
    const prev = this.scale;
    if (p90 > 24) this.scale = Math.max(0.55, this.scale - 0.1);
    else if (p90 < 14 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.05);
    return this.scale !== prev ? this.scale : null;
  }
}
