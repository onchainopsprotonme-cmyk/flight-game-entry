// ============================================================================
// Flight Game — World Simulation (world.js)
// Agent-authored rewrite.
//
// This module owns the entire flight physics simulation:
//   * Plane state (position, velocity, attitude, throttle, fuel, damage)
//   * Procedural terrain tiles generated on demand with height field
//   * Buildings and trees placed randomly, avoiding the runway
//   * Fuel-collector rings spawned ahead of the plane
//   * Runway definition and landing zone
//   * Mission state machine: rings -> land -> complete
//   * Fixed-step physics: throttle, controls, lift, thrust, drag, gravity, wind
//   * Collision detection: terrain, rings, runway landing
//
// createWorld() returns { state, reset, step, getGroundHeight, getTerrainColor }.
// state exposes plane, rings, runway, buildings, trees, mission fields.
// ============================================================================

// World: the flight simulation. Plane physics, procedural terrain, rings, runway,
// missions, collisions. Fixed-step, no drawing, no browser.

import {
  FIELD,
  PLANE,
  CAMERA,
  WORLD,
  MISSION,
  SCREEN,
  INPUT,
} from './config.js';
import {
  ACTION_THROTTLE_UP,
  ACTION_THROTTLE_DOWN,
  ACTION_BRAKE,
  ACTION_ROLL_LEFT,
  ACTION_ROLL_RIGHT,
  ACTION_PITCH_UP,
  ACTION_PITCH_DOWN,
} from './input.js';

const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;

// Seeded PRNG (xorshift32) so world generation is deterministic across runs.
let seed = 0x12345678;
function seededRandom() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
}

function randRange(min, max) {
  return min + seededRandom() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const EVENT_CRASH = 1;
export const EVENT_RING = 2;
export const EVENT_LAND = 4;
export const EVENT_MISSION_COMPLETE = 8;

export function createWorld() {
  // Plane state
  const plane = {
    x: 0,
    y: 120,
    z: -400,
    vx: 0,
    vy: 0,
    vz: 80,
    roll: 0,
    pitch: 0,
    yaw: 0,
    rollVel: 0,
    pitchVel: 0,
    yawVel: 0,
    throttle: 0.25,
    fuel: PLANE.fuelCapacity,
    damage: 0,
    speed: 0,
    altitude: 120,
    onGround: false,
    propellerAngle: 0,
    crashTimer: 0,
  };

  // Terrain tiles (procedural, generated on demand)
  const tiles = new Map();
  const buildings = [];
  const trees = [];

  // Rings (missile targets / gates)
  const rings = [];
  let ringIndex = 0;
  let ringsPassed = 0;

  // Runway
  const runway = {
    x: 0,
    z: 800,
    length: 600,
    width: 40,
    heading: 0,
  };

  // Mission state
  let mission = 'rings';
  let missionProgress = 0;
  let missionTarget = MISSION.ringsPerMission;
  let missionComplete = false;
  let score = 0;

  let time = 0;

  function seedTerrain() {
    buildings.length = 0;
    trees.length = 0;
    const count = Math.floor((FIELD.size / FIELD.tileSize) * 0.6);
    for (let i = 0; i < count; i += 1) {
      const bx = randRange(-FIELD.size / 2, FIELD.size / 2);
      const bz = randRange(-FIELD.size / 2, FIELD.size / 2);
      if (Math.abs(bz - runway.z) < runway.width * 3 && Math.abs(bx) < runway.length / 2 + 100) continue;
      buildings.push({
        x: bx,
        z: bz,
        width: randRange(12, 40),
        height: randRange(8, 45),
        depth: randRange(12, 40),
        color: 0x556644 + Math.floor(seededRandom() * 0x111111),
      });
    }
    for (let i = 0; i < count * 3; i += 1) {
      const tx = randRange(-FIELD.size / 2, FIELD.size / 2);
      const tz = randRange(-FIELD.size / 2, FIELD.size / 2);
      if (Math.abs(tz - runway.z) < runway.width * 4 && Math.abs(tx) < runway.length / 2 + 60) continue;
      trees.push({ x: tx, z: tz, size: randRange(3, 9), height: randRange(10, 25) });
    }
  }

  function spawnRings() {
    rings.length = 0;
    ringIndex = 0;
    ringsPassed = 0;
    const startZ = plane.z - 200;
    for (let i = 0; i < MISSION.ringsPerMission; i += 1) {
      const z = startZ - (i + 1) * MISSION.ringSpacing;
      const x = randRange(-150, 150);
      const y = 100 + i * 15 + seededRandom() * 60;
      rings.push({ x, y, z, radius: MISSION.ringRadius, passed: false });
    }
  }

  function reset() {
    seed = 0x12345678;
    plane.x = 0;
    plane.y = 150;
    plane.z = -400;
    plane.vx = 0;
    plane.vy = 0;
    plane.vz = 100;
    plane.roll = 0;
    plane.pitch = 0;
    plane.yaw = 0;
    plane.rollVel = 0;
    plane.pitchVel = 0;
    plane.yawVel = 0;
    plane.throttle = 0.3;
    plane.fuel = PLANE.fuelCapacity;
    plane.damage = 0;
    plane.crashTimer = 0;
    plane.onGround = false;
    mission = 'rings';
    missionProgress = 0;
    missionComplete = false;
    score = 0;
    time = 0;
    seedTerrain();
    spawnRings();
    runway.x = 0;
    runway.z = 1200;
    runway.heading = 0;
  }

  reset();

  function step(dt, input) {
    if (plane.crashTimer > 0) {
      plane.crashTimer -= dt;
      if (plane.crashTimer <= 0) {
        plane.damage = Math.min(PLANE.maxDamage, plane.damage + 40);
        if (plane.damage >= PLANE.maxDamage) return EVENT_CRASH;
        plane.y = 200;
        plane.vy = 0;
        plane.vx = 0;
        plane.vz = 80;
        plane.roll = 0;
        plane.pitch = 0;
        plane.crashTimer = 0;
      }
      return 0;
    }

    // ---- Throttle ----
    if (input.actions & ACTION_THROTTLE_UP) plane.throttle += dt * 0.8;
    if (input.actions & ACTION_THROTTLE_DOWN) plane.throttle -= dt * 0.8;
    if (input.actions & ACTION_BRAKE) plane.throttle -= dt * 1.6;
    plane.throttle = clamp(plane.throttle, 0, 1);

    // ---- Mouse look ----
    if (input.mouseLocked) {
      plane.yaw += input.dx * INPUT.mouseSensitivity * 60 * dt;
      plane.pitch += input.dy * INPUT.mouseSensitivity * 60 * dt;
    }

    // ---- Keyboard roll/pitch ----
    const rollDir = (input.actions & ACTION_ROLL_LEFT ? -1 : 0) + (input.actions & ACTION_ROLL_RIGHT ? 1 : 0);
    const pitchDir = (input.actions & ACTION_PITCH_UP ? -1 : 0) + (input.actions & ACTION_PITCH_DOWN ? 1 : 0);

    // ---- Apply controls ----
    const targetRoll = rollDir * 35 * DEG_TO_RAD;
    const targetPitch = pitchDir * 25 * DEG_TO_RAD;

    plane.rollVel += (targetRoll - plane.roll) * PLANE.rollRate * dt;
    plane.pitchVel += (targetPitch - plane.pitch) * PLANE.pitchRate * dt;
    plane.yawVel += ((-input.mouseLocked ? 0 : input.dx * 0.001) - plane.yawVel * 0.5) * dt;

    plane.roll += plane.rollVel * dt;
    plane.pitch += plane.pitchVel * dt;
    plane.yaw += plane.yawVel * dt;

    // Stability: auto-level when no input
    if (Math.abs(rollDir) < 0.5) plane.rollVel *= 1 - PLANE.stability * dt;
    if (Math.abs(pitchDir) < 0.5) plane.pitchVel *= 1 - PLANE.stability * dt;

    // Clamp angles
    plane.pitch = clamp(plane.pitch, -1.2, 1.0);

    // ---- Thrust ----
    const thrust = PLANE.idleThrust + plane.throttle * (PLANE.maxThrust - PLANE.idleThrust);

    // ---- Fuel burn ----
    const fuelBurn = PLANE.fuelBurnIdle + plane.throttle * (PLANE.fuelBurnFull - PLANE.fuelBurnIdle);
    plane.fuel -= fuelBurn * dt;
    if (plane.fuel <= 0) {
      plane.fuel = 0;
      plane.throttle = 0;
    }

    // ---- Physics ----
    const speed = Math.sqrt(plane.vx * plane.vx + plane.vy * plane.vy + plane.vz * plane.vz);
    plane.speed = speed;

    // Lift from wings (depends on speed and pitch)
    const airspeed = Math.max(speed, PLANE.stallSpeed);
    const lift = 0.5 * 1.225 * airspeed * airspeed * PLANE.liftCoefficient * 18;
    const liftVector = {
      x: -Math.sin(plane.roll) * Math.cos(plane.pitch),
      y: Math.cos(plane.roll) * Math.cos(plane.pitch),
      z: Math.sin(plane.pitch),
    };

    // Thrust vector (plane's forward)
    const cr = Math.cos(plane.roll), sr = Math.sin(plane.roll);
    const cp = Math.cos(plane.pitch), sp = Math.sin(plane.pitch);
    const cy = Math.cos(plane.yaw), sy = Math.sin(plane.yaw);
    const forward = {
      x: sy * cp,
      y: -sp,
      z: -cy * cp,
    };
    const up = { x: -sr * sp, y: cr * cp, z: -sy * sp };

    // Gravity + wind
    const gx = WORLD.wind.x;
    const gy = -WORLD.gravity;
    const gz = WORLD.wind.z;

    // Accumulate forces
    let ax = forward.x * thrust / PLANE.mass + liftVector.x * lift / PLANE.mass + gx;
    let ay = forward.y * thrust / PLANE.mass + liftVector.y * lift / PLANE.mass + gy;
    let az = forward.z * thrust / PLANE.mass + liftVector.z * lift / PLANE.mass + gz;

    // Drag
    const drag = PLANE.dragCoefficient * speed * speed;
    ax -= (plane.vx / speed) * drag;
    ay -= (plane.vy / speed) * drag;
    az -= (plane.vz / speed) * drag;

    // Integrate
    plane.vx += ax * dt;
    plane.vy += ay * dt;
    plane.vz += az * dt;

    plane.x += plane.vx * dt;
    plane.y += plane.vy * dt;
    plane.z += plane.vz * dt;

    plane.propellerAngle += dt * 20;

    // Terrain collision
    const groundHeight = getGroundHeight(plane.x, plane.z);
    plane.altitude = plane.y - groundHeight;

    if (plane.y <= groundHeight + 3) {
      plane.y = groundHeight + 3;
      plane.vy = Math.min(0, plane.vy);
      if (speed > 60) {
        plane.crashTimer = 0.5;
        return EVENT_CRASH;
      }
      plane.onGround = true;
    } else {
      plane.onGround = false;
    }

    // ---- Fuel pickup rings ----
    let events = 0;
    if (mission === 'rings' && !missionComplete) {
      const currentRing = rings[ringIndex];
      if (currentRing && !currentRing.passed) {
        const dx = plane.x - currentRing.x;
        const dy = plane.y - currentRing.y;
        const dz = plane.z - currentRing.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < currentRing.radius + 12) {
          currentRing.passed = true;
          ringsPassed += 1;
          ringIndex += 1;
          plane.fuel = Math.min(PLANE.fuelCapacity, plane.fuel + MISSION.refuelPerRing);
          score += 100;
          events |= EVENT_RING;
          if (ringsPassed >= MISSION.ringsPerMission) {
            missionComplete = true;
            mission = 'land';
            missionTarget = 1;
            missionProgress = 0;
            events |= EVENT_MISSION_COMPLETE;
          }
        }
      }
    }

    // ---- Runway landing ----
    if (mission === 'land' && !plane.onGround && plane.altitude < 15) {
      const dx = plane.x - runway.x;
      const dz = plane.z - runway.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const alongRunway = Math.abs(dz) < runway.length / 2 + 30;
      const acrossRunway = Math.abs(dx) < runway.width / 2 + 15;
      if (alongRunway && acrossRunway && speed < MISSION.landSpeedMax && Math.abs(plane.vy) < MISSION.landVerticalSpeedMax) {
        plane.y = groundHeight + 3;
        plane.vy = 0;
        plane.onGround = true;
        score += 500;
        events |= EVENT_LAND;
        missionComplete = true;
      }
    }

    time += dt;
    plane.altitude = Math.max(0, plane.altitude);
    return events;
  }

  function getGroundHeight(x, z) {
    const gridX = Math.floor(x / FIELD.tileSize);
    const gridZ = Math.floor(z / FIELD.tileSize);
    const key = `${gridX},${gridZ}`;
    let tile = tiles.get(key);
    if (!tile) {
      const hx = Math.sin(x * 0.002) * 8 + Math.cos(z * 0.0015) * 6;
      tile = { height: hx };
      tiles.set(key, tile);
      if (tiles.size > 300) tiles.delete(tiles.keys().next().value);
    }
    return tile.height;
  }

  function getTerrainColor(x, z) {
    const h = getGroundHeight(x, z);
    if (h > 10) return 0x3a5a2a; // high ground = darker green
    return 0x5a8a44; // fields
  }

  return {
    state: { plane, rings, runway, buildings, trees, mission, missionProgress, missionTarget, missionComplete, score, time, getGroundHeight, getTerrainColor },
    reset,
    step,
    getGroundHeight,
    getTerrainColor,
  };
}

// ---- Agent-authored additions: distance and scoring helpers ----
// Euclidean distance between two points in the XZ plane.
export function distanceXZ(x1, z1, x2, z2) {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

// Score a runway landing attempt based on speed, vertical speed, and alignment.
// Returns points (0-1000) and a quality string.
export function scoreLanding(speed, verticalSpeed, alignDegrees) {
  let points = 500;
  if (speed > MISSION.landSpeedMax) points -= (speed - MISSION.landSpeedMax) * 2;
  if (Math.abs(verticalSpeed) > MISSION.landVerticalSpeedMax) {
    points -= (Math.abs(verticalSpeed) - MISSION.landVerticalSpeedMax) * 10;
  }
  if (alignDegrees > MISSION.landAlignMaxDegrees) {
    points -= (alignDegrees - MISSION.landAlignMaxDegrees) * 5;
  }
  points = Math.max(0, Math.min(1000, points));
  let quality = 'poor';
  if (points >= 800) quality = 'excellent';
  else if (points >= 600) quality = 'good';
  else if (points >= 400) quality = 'fair';
  return { points, quality };
}

// ---- Agent-authored additions: PlaneState class ----
// Encapsulates plane physics state and provides computed accessors.
export class PlaneState {
  constructor() {
    this.x = 0;
    this.y = 120;
    this.z = -400;
    this.vx = 0;
    this.vy = 0;
    this.vz = 80;
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.rollVel = 0;
    this.pitchVel = 0;
    this.yawVel = 0;
    this.throttle = 0.25;
    this.fuel = PLANE.fuelCapacity;
    this.damage = 0;
    this.speed = 0;
    this.altitude = 120;
    this.onGround = false;
    this.propellerAngle = 0;
    this.crashTimer = 0;
  }

  reset() {
    this.x = 0;
    this.y = 150;
    this.z = -400;
    this.vx = 0;
    this.vy = 0;
    this.vz = 100;
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.rollVel = 0;
    this.pitchVel = 0;
    this.yawVel = 0;
    this.throttle = 0.3;
    this.fuel = PLANE.fuelCapacity;
    this.damage = 0;
    this.crashTimer = 0;
    this.onGround = false;
  }

  speed3d() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
  }

  fuelPercent() {
    return (this.fuel / PLANE.fuelCapacity) * 100;
  }

  isStalled() {
    return this.speed3d() < PLANE.stallSpeed && this.altitude > 5;
  }

  applyThrust(dt) {
    const thrust = PLANE.idleThrust + this.throttle * (PLANE.maxThrust - PLANE.idleThrust);
    return thrust / PLANE.mass;
  }

  burnFuel(dt) {
    const burn = PLANE.fuelBurnIdle + this.throttle * (PLANE.fuelBurnFull - PLANE.fuelBurnIdle);
    this.fuel = Math.max(0, this.fuel - burn * dt);
    if (this.fuel <= 0) {
      this.fuel = 0;
      this.throttle = 0;
    }
  }

  // ---- Agent-authored additions: PlaneState methods ----
  update(dt, input) {
    this.rollVel += input.roll * PLANE.rollAccel * dt;
    this.pitchVel += input.pitch * PLANE.pitchAccel * dt;
    this.yawVel += input.yaw * PLANE.yawAccel * dt;

    this.rollVel *= 1 - PLANE.rollDamping * dt;
    this.pitchVel *= 1 - PLANE.pitchDamping * dt;
    this.yawVel *= 1 - PLANE.yawDamping * dt;

    this.roll += this.rollVel * dt;
    this.pitch += this.pitchVel * dt;
    this.yaw += this.yawVel * dt;

    const thrust = this.applyThrust(dt);
    const forwardX = -Math.sin(this.yaw) * Math.cos(this.pitch);
    const forwardZ = -Math.cos(this.yaw) * Math.cos(this.pitch);
    const forwardY = Math.sin(this.pitch);

    this.vx += forwardX * thrust * dt;
    this.vy += forwardY * thrust * dt - PLANE.gravity * dt;
    this.vz += forwardZ * thrust * dt;

    const drag = PLANE.dragCoefficient * this.speed3d() * dt;
    this.vx *= 1 - drag;
    this.vy *= 1 - drag;
    this.vz *= 1 - drag;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    this.speed = this.speed3d();
    this.altitude = this.y - this.getGroundHeight(this.x, this.z);

    this.burnFuel(dt);
    this.propellerAngle += PLANE.propellerSpeed * dt;
    if (this.crashTimer > 0) this.crashTimer -= dt;
  }

  takeDamage(amount) {
    this.damage = Math.min(100, this.damage + amount);
    if (this.damage >= 100) {
      this.crashTimer = 2;
    }
  }
}
