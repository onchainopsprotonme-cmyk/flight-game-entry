// ============================================================================
// Flight Game — Configuration Constants (config.js)
// Agent-authored rewrite.
//
// All game tuning constants live here in one place:
//   * FIELD — play area size, ground level, tile size, view distance
//   * PLANE — mass, thrust, speed, lift/drag, roll/pitch/yaw rates, fuel, damage
//   * CAMERA — chase distance, height, lag, look-ahead
//   * WORLD — gravity, wind, thermal lift
//   * MISSION — ring radius/spacing, rings per mission, landing thresholds, refuel
//   * HUD — font sizes, margins, panel width
//   * SCREEN — state machine string constants
//   * INPUT — deadzone, mouse sensitivity
//   * DEBUG — collision boxes, ring numbers, frame time logging
//   * AUDIO — enabled, engine volume, wind volume
//
// ============================================================================

// Flight game configuration constants. One clear job: every number the game tunes itself by.

export const FIELD = {
  size: 4000,
  groundY: 0,
  tileSize: 200,
  viewDistance: 1200,
};

export const PLANE = {
  mass: 1200,
  maxThrust: 45000,
  minThrust: 2000,
  idleThrust: 4000,
  thrustRate: 18000,
  maxSpeed: 260,
  stallSpeed: 70,
  liftCoefficient: 0.45,
  dragCoefficient: 0.03,
  rollRate: 90,
  pitchRate: 70,
  yawRate: 30,
  stability: 0.85,
  fuelCapacity: 1000,
  fuelBurnIdle: 0.6,
  fuelBurnFull: 4.0,
  damagePerCollision: 25,
  maxDamage: 100,
};

export const CAMERA = {
  chaseDistance: 18,
  chaseHeight: 8,
  chaseLag: 0.12,
  lookAhead: 12,
};

export const WORLD = {
  gravity: 15,
  wind: { x: 0.5, z: -0.3 },
  thermalLift: 0.4,
};

export const MISSION = {
  ringRadius: 22,
  ringSpacing: 400,
  ringsPerMission: 6,
  landSpeedMax: 90,
  landVerticalSpeedMax: 8,
  landAlignMaxDegrees: 15,
  refuelPerRing: 25,
};

export const HUD = {
  fontSize: 20,
  fontSizeLarge: 28,
  margin: 24,
  panelWidth: 320,
};

export const SCREEN = {
  TITLE: 'title',
  PLAY: 'play',
  PAUSED: 'paused',
  MISSION_COMPLETE: 'missionComplete',
  GAME_OVER: 'gameOver',
};

export const INPUT = {
  deadzone: 0.12,
  mouseSensitivity: 0.002,
};

export const DEBUG = {
  showCollisionBoxes: false,
  showRingNumbers: true,
  logFrameTime: false,
};

export const AUDIO = {
  enabled: true,
  engineVolume: 0.5,
  windVolume: 0.3,
};

// ---- Agent-authored additions: difficulty presets ----
// Named difficulty configurations used to scale plane handling and mission
// difficulty. Each preset overrides a subset of PLANE / MISSION values.
export const DIFFICULTY = {
  easy: {
    plane: { rollRate: 120, pitchRate: 90, yawRate: 40, stability: 0.95, maxSpeed: 300 },
    mission: { ringSpacing: 500, ringsPerMission: 4, landSpeedMax: 110, landVerticalSpeedMax: 12 },
  },
  normal: {
    plane: { rollRate: 90, pitchRate: 70, yawRate: 30, stability: 0.85, maxSpeed: 260 },
    mission: { ringSpacing: 400, ringsPerMission: 6, landSpeedMax: 90, landVerticalSpeedMax: 8 },
  },
  hard: {
    plane: { rollRate: 70, pitchRate: 50, yawRate: 20, stability: 0.75, maxSpeed: 220 },
    mission: { ringSpacing: 300, ringsPerMission: 8, landSpeedMax: 70, landVerticalSpeedMax: 5 },
  },
};

// Return a difficulty preset by name, falling back to 'normal'.
export function getDifficulty(name) {
  return DIFFICULTY[name] ?? DIFFICULTY.normal;
}
