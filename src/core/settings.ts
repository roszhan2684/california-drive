import type { QualityPreset } from './quality.ts';
import type { AssistSettings } from '../physics/vehicle/config.ts';
import { DEFAULT_ASSISTS } from '../physics/vehicle/config.ts';
import type { SessionStore } from './session.ts';
import type { KeyBindings } from '../input/bindings.ts';
import { DEFAULT_KEYS } from '../input/bindings.ts';

export interface Settings {
  quality: QualityPreset;
  adaptiveResolution: boolean;
  motionBlur: boolean;
  bloom: boolean;
  reflections: boolean;
  volumetrics: boolean;
  shadows: boolean;
  ambientOcclusion: boolean;
  trafficDensity: number;
  reducedMotion: boolean;
  units: 'mph' | 'kmh';
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  music: boolean;
  assists: AssistSettings;
  keys: KeyBindings;
  minimap: boolean;
  /** Screen-space target lock on nearby activities and checkpoints. */
  targetLock: boolean;
  streetNames: boolean;
  fov: number;
  showFps: boolean;
  vehicle: 'm3c' | 'vireo';
  /** Show real manufacturer badges on branded cars (personal use). */
  badges: boolean;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultSettings(): Settings {
  return {
    quality: 'high',
    adaptiveResolution: true,
    motionBlur: true,
    bloom: true,
    reflections: true,
    volumetrics: true,
    shadows: true,
    ambientOcclusion: true,
    trafficDensity: 1,
    reducedMotion: prefersReducedMotion(),
    units: 'mph',
    masterVolume: 0.8,
    musicVolume: 0.45,
    sfxVolume: 0.9,
    music: false,
    assists: { ...DEFAULT_ASSISTS },
    keys: structuredClone(DEFAULT_KEYS),
    minimap: true,
    targetLock: true,
    streetNames: true,
    fov: 62,
    showFps: false,
    // public builds ship without the branded M3 (see PUBLIC_BUILD in vehicles.ts)
    vehicle: import.meta.env?.VITE_PUBLIC_BUILD === '1' ? 'vireo' : 'm3c',
    badges: true,
  };
}

export function loadSettings(store: SessionStore): Settings {
  const d = defaultSettings();
  const s = store.get<Partial<Settings>>('settings', {});
  return { ...d, ...s, assists: { ...d.assists, ...(s.assists ?? {}) }, keys: { ...d.keys, ...(s.keys ?? {}) } };
}

export function saveSettings(store: SessionStore, s: Settings) {
  store.set('settings', s);
}
