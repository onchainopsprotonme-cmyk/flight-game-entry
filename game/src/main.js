// ============================================================================
// Flight Game — Entry Point and Game Loop (main.js)
// Agent-authored rewrite.
//
// This module boots the game and runs the fixed-step game loop:
//   * Imports THREE.js, config, input, world, renderer
//   * State machine: title -> play -> paused / mission complete / game over
//   * startGame() / endGame() transitions
//   * step(dt, input) advances the world and checks crash / mission events
//   * frame(now) runs the render loop with accumulator-based fixed steps
//   * runShot(name) runs headless simulation frames for screenshot capture
//   * URL ?shot= parameter triggers screenshot mode for title, play, mission
// ============================================================================

// Main: boot, game loop, state machine. Title -> play -> paused / mission complete / game over.

import * as THREE from '../../vendor/three.min.js';
import { FIELD, PLANE, CAMERA, MISSION, SCREEN } from './config.js';
import { createInput } from './input.js';
import { createWorld, EVENT_CRASH, EVENT_MISSION_COMPLETE } from './world.js';
import { createRenderer } from './render.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const canvas = document.getElementById('game');
const input = createInput(canvas);
const world = createWorld();
const render = createRenderer(canvas);

let screen = SCREEN.TITLE;
let accumulator = 0;
let last = performance.now();

function startGame() {
  world.reset();
  screen = SCREEN.PLAY;
  accumulator = 0;
  last = performance.now();
}

function endGame() {
  screen = SCREEN.GAME_OVER;
}

function step(dt, inputState) {
  const events = world.step(dt, inputState);
  if (events & EVENT_CRASH) endGame();
  else if (events & EVENT_MISSION_COMPLETE) {
    screen = SCREEN.MISSION_COMPLETE;
  }
}

function frame(now) {
  requestAnimationFrame(frame);

  if (screen === SCREEN.TITLE || screen === SCREEN.PLAY || screen === SCREEN.MISSION_COMPLETE) {
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
  } else {
    accumulator = 0;
  }

  const inputState = input.read();

  if (screen === SCREEN.PLAY) {
    while (accumulator >= STEP) {
      step(STEP, inputState);
      accumulator -= STEP;
    }
  }

  render.draw(world.state, screen, inputState);
}

function runShot(name) {
  world.reset();
  const dummyInput = { actions: 0, dx: 0, dy: 0, mouseLocked: false };
  let steps = 120;
  if (name === 'title') steps = 0;
  else if (name === 'mission') steps = 300;
  for (let i = 0; i < steps; i += 1) {
    world.step(STEP, dummyInput);
  }
  render.draw(world.state, screen, dummyInput);
  render.draw(world.state, screen, dummyInput);
  render.draw(world.state, screen, dummyInput);
  window.__shotReady = true;
}

// ---- Agent-authored additions: shot stats and frame counter ----
// Cumulative counters exposed for the screenshot harness and HUD debug.
const shotStats = { frames: 0, shots: 0, lastShot: null };

export function getShotStats() {
  return { ...shotStats };
}

function runShotWithStats(name) {
  shotStats.shots += 1;
  shotStats.lastShot = name;
  runShot(name);
}

const originalRunShot = runShot;
window.runShot = runShotWithStats;

// Frame counter incremented each draw call for diagnostics.
let frameCount = 0;
const originalFrame = frame;
frame = function frame(now) {
  frameCount += 1;
  shotStats.frames = frameCount;
  originalFrame(now);
};


const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');

if (shot) {
  runShot(shot);
} else {
  startGame();
  requestAnimationFrame(frame);
}
