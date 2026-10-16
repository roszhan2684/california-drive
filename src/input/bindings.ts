export type Action =
  | 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake'
  | 'gearUp' | 'gearDown' | 'camera' | 'cameraPrev' | 'lookBack' | 'reset'
  | 'horn' | 'headlights' | 'highBeam' | 'indicatorLeft' | 'indicatorRight' | 'hazards'
  | 'engine' | 'wipers' | 'parkingBrake' | 'pause' | 'photo' | 'activity' | 'debug' | 'tuning' | 'music';

export type KeyBindings = Record<Action, string[]>;

export const ACTION_LABELS: Record<Action, string> = {
  throttle: 'Throttle', brake: 'Brake / Reverse', steerLeft: 'Steer left', steerRight: 'Steer right', handbrake: 'Handbrake / drift',
  gearUp: 'Gear up (manual)', gearDown: 'Gear down (manual)', camera: 'Next camera', cameraPrev: 'Previous camera', lookBack: 'Look back',
  reset: 'Reset vehicle', horn: 'Horn', headlights: 'Headlights', highBeam: 'High beam', indicatorLeft: 'Left indicator',
  indicatorRight: 'Right indicator', hazards: 'Hazards', engine: 'Engine start/stop', wipers: 'Wipers', parkingBrake: 'Parking brake',
  pause: 'Pause menu', photo: 'Photo mode', activity: 'Start / cancel activity', debug: 'Performance overlay', tuning: 'Tuning panel', music: 'Music on/off',
};

export const DEFAULT_KEYS: KeyBindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  gearUp: ['KeyE'],
  gearDown: ['KeyQ'],
  camera: ['KeyC'],
  cameraPrev: ['KeyX'],
  lookBack: ['KeyB'],
  reset: ['KeyR'],
  horn: ['KeyH'],
  headlights: ['KeyL'],
  highBeam: ['KeyK'],
  indicatorLeft: ['KeyZ'],
  indicatorRight: ['KeyV'],
  hazards: ['KeyG'],
  engine: ['KeyI'],
  wipers: ['KeyJ'],
  parkingBrake: ['KeyP'],
  pause: ['Escape'],
  photo: ['KeyF'],
  activity: ['KeyT'],
  debug: ['F3'],
  tuning: ['F4'],
  music: ['KeyM'],
};

/** Standard-mapping gamepad (https://w3c.github.io/gamepad/#remapping). */
export const PAD = {
  throttleTrigger: 7,
  brakeTrigger: 6,
  steerAxis: 0,
  lookX: 2,
  lookY: 3,
  handbrake: 0, // A / Cross
  camera: 3, // Y / Triangle
  lookBack: 2, // X / Square
  reset: 1, // B / Circle
  gearDown: 4, // LB
  gearUp: 5, // RB
  pause: 9, // Start
  photo: 8, // Back/Select
  horn: 10, // L3
  headlights: 12, // dpad up
  wipers: 13, // dpad down
  indicatorLeft: 14,
  indicatorRight: 15,
  activity: 11, // R3
} as const;

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  if (code === 'Space') return 'Space';
  if (code === 'Escape') return 'Esc';
  return code.replace('Left', 'L').replace('Right', 'R');
}
