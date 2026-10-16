import { M3_COMP, VIREO_S6, type VehicleConfig } from '../physics/vehicle/config.ts';
import { buildCar, PAINTS, type CarRig, type Paint } from './carModel.ts';
import { buildM3, M3_PAINTS } from './m3Model.ts';

export type VehicleId = 'm3c' | 'vireo';

export interface EngineSound {
  /** Inline-six vs flat-six harmonic balance. */
  tone: 'inline6' | 'flat6';
  turbo: boolean;
}

/** Spec sheet. Power/torque/mass come from the sim config; times and distances were measured on the sim (tests/unit/vehicle.test.ts). */
export interface VehicleSpecs {
  hp: number;
  nm: number;
  kg: number;
  zeroTo100: number;
  topKmh: number;
  brake100: number;
  layout: string;
}

export interface VehicleDef {
  id: VehicleId;
  name: string;
  tagline: string;
  config: VehicleConfig;
  paints: Paint[];
  /** Uses real manufacturer trademarks (personal use only; see ASSET_LICENSES.md). */
  branded: boolean;
  sound: EngineSound;
  chase: { distance: number; height: number };
  specs: VehicleSpecs;
  build(paint: string, matte?: boolean): CarRig;
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  m3c: {
    id: 'm3c',
    name: 'BMW M3 Competition',
    tagline: 'G80 · 3.0 L twin-turbo inline-six · 503 hp · RWD',
    config: M3_COMP,
    paints: M3_PAINTS,
    branded: true,
    sound: { tone: 'inline6', turbo: true },
    chase: { distance: 6.9, height: 1.95 },
    specs: { hp: 503, nm: 650, kg: M3_COMP.mass, zeroTo100: 4.4, topKmh: 290, brake100: 33.0, layout: 'Front-engine · RWD · 8-speed auto' },
    build: (p, m) => buildM3(p, m),
  },
  vireo: {
    id: 'vireo',
    name: 'Vireo S6',
    tagline: 'Fictional rear-engine coupe · flat-six · 480 hp',
    config: VIREO_S6,
    paints: PAINTS,
    branded: false,
    sound: { tone: 'flat6', turbo: false },
    chase: { distance: 6.4, height: 1.85 },
    specs: { hp: 480, nm: 530, kg: VIREO_S6.mass, zeroTo100: 3.9, topKmh: 297, brake100: 36.7, layout: 'Rear-engine · RWD · 7-speed dual-clutch' },
    build: (p) => buildCar(p),
  },
};

/**
 * Public builds (GitHub Pages, `VITE_PUBLIC_BUILD=1`) leave out branded vehicles: the M3 is approved for
 * personal, non-commercial use only (see ASSET_LICENSES.md). Local builds keep it.
 */
export const PUBLIC_BUILD = import.meta.env?.VITE_PUBLIC_BUILD === '1';

/** Vehicles offered in the garage for this build. */
export const AVAILABLE_VEHICLES: VehicleDef[] = Object.values(VEHICLES).filter((v) => !(PUBLIC_BUILD && v.branded));

export const DEFAULT_VEHICLE: VehicleId = PUBLIC_BUILD ? 'vireo' : 'm3c';

export function vehicleDef(id: string | undefined): VehicleDef {
  const v = VEHICLES[(id as VehicleId)];
  return v && AVAILABLE_VEHICLES.includes(v) ? v : VEHICLES[DEFAULT_VEHICLE];
}
