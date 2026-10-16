// Vehicle tuning data. All values SI. Local frame: +x right, +y up, -z forward.

export interface WheelDef {
  /** Suspension anchor (top of travel) in chassis-local coordinates. */
  x: number;
  y: number;
  z: number;
  front: boolean;
  left: boolean;
}

export interface VehicleConfig {
  name: string;
  mass: number;
  /** Center of mass offset in chassis-local coordinates. */
  com: { x: number; y: number; z: number };
  inertia: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
  wheelRadius: number;
  wheelInertia: number;
  wheels: WheelDef[];
  suspension: {
    restLength: number;
    maxTravel: number;
    stiffnessFront: number;
    stiffnessRear: number;
    bumpDampFront: number;
    bumpDampRear: number;
    reboundDampFront: number;
    reboundDampRear: number;
    antiRollFront: number;
    antiRollRear: number;
  };
  tire: {
    mu: number;
    /** Slip ratio at peak longitudinal force. */
    peakSlipRatio: number;
    /** Slip angle (rad) at peak lateral force. */
    peakSlipAngle: number;
    /** Magic-formula shape C; controls how much grip remains when sliding. */
    shape: number;
    /** Rear lateral grip multiplier (handling balance). */
    rearLatGrip: number;
    rollingResistance: number;
  };
  steering: {
    maxAngle: number;
    /** Speed (m/s) at which the steering lock halves. */
    halfLockSpeed: number;
    rate: number;
    ackermann: number;
  };
  engine: {
    idleRpm: number;
    redlineRpm: number;
    limiterRpm: number;
    /** [rpm, Nm] full-throttle torque curve. */
    torqueCurve: [number, number][];
    engineBrakeNm: number;
    inertia: number;
  };
  gearbox: {
    ratios: number[];
    reverse: number;
    final: number;
    efficiency: number;
    shiftTime: number;
    upRpm: number;
    downRpm: number;
  };
  diff: { preloadNm: number; lockRatio: number };
  brakes: { maxTorque: number; frontBias: number; handbrakeTorque: number };
  aero: { cdA: number; clA: number; frontDownforceShare: number };
  /** Electronic top-speed limiter (m/s), optional. */
  topSpeed?: number;
  assists: {
    absSlip: number;
    tcsSlip: number;
    escYawMargin: number;
    escGain: number;
    steerAssistGain: number;
  };
}

/** "Vireo S6": fictional rear-engine German-style sports coupe. No real brand, badge or model is represented. */
export const VIREO_S6: VehicleConfig = {
  name: 'Vireo S6',
  mass: 1460,
  com: { x: 0, y: -0.25, z: 0.26 },
  inertia: { x: 2350, y: 2650, z: 620 },
  halfExtents: { x: 0.9, y: 0.4, z: 2.22 },
  wheelRadius: 0.34,
  wheelInertia: 1.3,
  wheels: [
    { x: -0.79, y: -0.12, z: -1.2, front: true, left: true },
    { x: 0.79, y: -0.12, z: -1.2, front: true, left: false },
    { x: -0.81, y: -0.12, z: 1.25, front: false, left: true },
    { x: 0.81, y: -0.12, z: 1.25, front: false, left: false },
  ],
  suspension: {
    restLength: 0.36,
    maxTravel: 0.24,
    stiffnessFront: 39000,
    stiffnessRear: 64000,
    bumpDampFront: 2300,
    bumpDampRear: 3300,
    reboundDampFront: 3300,
    reboundDampRear: 4600,
    antiRollFront: 26000,
    antiRollRear: 17000,
  },
  tire: {
    mu: 1.18,
    peakSlipRatio: 0.1,
    peakSlipAngle: 0.13,
    shape: 1.45,
    rearLatGrip: 1.04,
    rollingResistance: 0.012,
  },
  steering: { maxAngle: 0.6, halfLockSpeed: 30, rate: 3.2, ackermann: 0.12 },
  engine: {
    idleRpm: 900,
    redlineRpm: 7800,
    limiterRpm: 8100,
    torqueCurve: [
      [0, 260], [1000, 300], [2000, 420], [2600, 510], [4000, 530], [6000, 520], [7000, 485], [7800, 440], [8400, 360],
    ],
    engineBrakeNm: 70,
    inertia: 0.22,
  },
  gearbox: {
    ratios: [3.75, 2.38, 1.72, 1.34, 1.08, 0.88, 0.71],
    reverse: 3.4,
    final: 3.44,
    efficiency: 0.88,
    shiftTime: 0.14,
    upRpm: 7400,
    downRpm: 3000,
  },
  diff: { preloadNm: 60, lockRatio: 0.35 },
  brakes: { maxTorque: 13500, frontBias: 0.64, handbrakeTorque: 4200 },
  aero: { cdA: 0.74, clA: 0.32, frontDownforceShare: 0.42 },
  assists: { absSlip: 0.14, tcsSlip: 0.12, escYawMargin: 0.18, escGain: 2600, steerAssistGain: 0.45 },
};

/**
 * M3 Competition (G80) approximation from public specifications: S58 3.0 L twin-turbo inline-six,
 * 375 kW @ 6250 rpm, 650 Nm 2750-5500 rpm, 8-speed M Steptronic, Active M Differential, RWD,
 * ~1730 kg, 2857 mm wheelbase, 53/47 weight split, 290 km/h limited (M Driver's Package).
 */
export const M3_COMP: VehicleConfig = {
  name: 'M3 Competition',
  mass: 1730,
  com: { x: 0, y: -0.22, z: -0.126 },
  inertia: { x: 3100, y: 3400, z: 760 },
  halfExtents: { x: 0.93, y: 0.42, z: 2.35 },
  wheelRadius: 0.34,
  wheelInertia: 1.5,
  wheels: [
    { x: -0.79, y: -0.12, z: -1.47, front: true, left: true },
    { x: 0.79, y: -0.12, z: -1.47, front: true, left: false },
    { x: -0.78, y: -0.12, z: 1.39, front: false, left: true },
    { x: 0.78, y: -0.12, z: 1.39, front: false, left: false },
  ],
  suspension: {
    restLength: 0.36,
    maxTravel: 0.22,
    stiffnessFront: 65000,
    stiffnessRear: 64000,
    bumpDampFront: 2700,
    bumpDampRear: 2500,
    reboundDampFront: 3900,
    reboundDampRear: 3600,
    antiRollFront: 30000,
    antiRollRear: 18000,
  },
  tire: { mu: 1.34, peakSlipRatio: 0.11, peakSlipAngle: 0.12, shape: 1.5, rearLatGrip: 1.0, rollingResistance: 0.012 },
  steering: { maxAngle: 0.58, halfLockSpeed: 30, rate: 3.0, ackermann: 0.12 },
  engine: {
    idleRpm: 750,
    redlineRpm: 7200,
    limiterRpm: 7300,
    torqueCurve: [[0, 300], [1000, 380], [2000, 560], [2750, 650], [5500, 650], [6250, 573], [7000, 500], [7300, 460], [7800, 380]],
    engineBrakeNm: 85,
    inertia: 0.24,
  },
  gearbox: {
    ratios: [5.0, 3.2, 2.143, 1.72, 1.313, 1.0, 0.823, 0.64],
    reverse: 3.456,
    final: 3.154,
    efficiency: 0.88,
    shiftTime: 0.1,
    upRpm: 6900,
    downRpm: 2600,
  },
  diff: { preloadNm: 80, lockRatio: 0.45 },
  brakes: { maxTorque: 15500, frontBias: 0.62, handbrakeTorque: 4200 },
  aero: { cdA: 0.78, clA: 0.15, frontDownforceShare: 0.5 },
  topSpeed: 290 / 3.6,
  assists: { absSlip: 0.14, tcsSlip: 0.12, escYawMargin: 0.18, escGain: 2800, steerAssistGain: 0.45 },
};

export interface AssistSettings {
  abs: boolean;
  tcs: boolean;
  esc: boolean;
  steerAssist: boolean;
  autoGearbox: boolean;
}

export const DEFAULT_ASSISTS: AssistSettings = { abs: true, tcs: true, esc: true, steerAssist: true, autoGearbox: true };
