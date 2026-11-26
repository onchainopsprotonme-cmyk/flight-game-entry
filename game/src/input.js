// Input: keyboard and mouse state for the flight controls.
// Throttle: W/S. Roll: A/D or left/right arrow. Pitch: up/down arrow or mouse.
// Brake: Space. Mouse look: pointer lock.

const KEY_THROTTLE_UP = 'KeyW';
const KEY_THROTTLE_DOWN = 'KeyS';
const KEY_ROLL_LEFT = 'KeyA';
const KEY_ROLL_RIGHT = 'KeyD';
const KEY_PITCH_UP = 'ArrowUp';
const KEY_PITCH_DOWN = 'ArrowDown';
const KEY_ALT_ROLL_LEFT = 'ArrowLeft';
const KEY_ALT_ROLL_RIGHT = 'ArrowRight';
const KEY_BRAKE = 'Space';
const KEY_MOUSE_LOOK = 'KeyM';

export const ACTION_THROTTLE_UP = 1;
export const ACTION_THROTTLE_DOWN = 2;
export const ACTION_ROLL_LEFT = 4;
export const ACTION_ROLL_RIGHT = 8;
export const ACTION_PITCH_UP = 16;
export const ACTION_PITCH_DOWN = 32;
export const ACTION_BRAKE = 64;
export const ACTION_TOGGLE_MOUSE = 128;

const keyMap = {
  [KEY_THROTTLE_UP]: ACTION_THROTTLE_UP,
  [KEY_THROTTLE_DOWN]: ACTION_THROTTLE_DOWN,
  [KEY_ROLL_LEFT]: ACTION_ROLL_LEFT,
  [KEY_ROLL_RIGHT]: ACTION_ROLL_RIGHT,
  [KEY_ALT_ROLL_LEFT]: ACTION_ROLL_LEFT,
  [KEY_ALT_ROLL_RIGHT]: ACTION_ROLL_RIGHT,
  [KEY_PITCH_UP]: ACTION_PITCH_UP,
  [KEY_PITCH_DOWN]: ACTION_PITCH_DOWN,
  [KEY_BRAKE]: ACTION_BRAKE,
  [KEY_MOUSE_LOOK]: ACTION_TOGGLE_MOUSE,
};

export function createInput(canvas) {
  const keys = {};
  let mouseLocked = false;
  let mouseDX = 0;
  let mouseDY = 0;

  function onKeyDown(event) {
    keys[event.code] = true;
    if (event.code === KEY_MOUSE_LOOK && !keys._mouseToggle) {
      keys._mouseToggle = true;
      toggleMouseLock(canvas);
    }
  }

  function onKeyUp(event) {
    keys[event.code] = false;
    if (event.code === KEY_MOUSE_LOOK) keys._mouseToggle = false;
  }

  function toggleMouseLock(element) {
    if (!mouseLocked) {
      element.requestPointerLock().catch(() => {});
    } else {
      document.exitPointerLock();
    }
  }

  function onPointerLockChange() {
    mouseLocked = document.pointerLockElement === canvas;
  }

  function onMouseMove(event) {
    if (mouseLocked) {
      mouseDX += event.movementX;
      mouseDY += event.movementY;
    }
  }

  function onMouseDown() {
    if (!mouseLocked) canvas.requestPointerLock().catch(() => {});
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);

  return {
    read() {
      let actions = 0;
      if (keys[KEY_THROTTLE_UP]) actions |= ACTION_THROTTLE_UP;
      if (keys[KEY_THROTTLE_DOWN]) actions |= ACTION_THROTTLE_DOWN;
      if (keys[KEY_ROLL_LEFT] || keys[KEY_ALT_ROLL_LEFT]) actions |= ACTION_ROLL_LEFT;
      if (keys[KEY_ROLL_RIGHT] || keys[KEY_ALT_ROLL_RIGHT]) actions |= ACTION_ROLL_RIGHT;
      if (keys[KEY_PITCH_UP]) actions |= ACTION_PITCH_UP;
      if (keys[KEY_PITCH_DOWN]) actions |= ACTION_PITCH_DOWN;
      if (keys[KEY_BRAKE]) actions |= ACTION_BRAKE;
      const dx = mouseDX;
      const dy = mouseDY;
      mouseDX = 0;
      mouseDY = 0;
      return { actions, dx, dy, mouseLocked };
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
    },
  };
}
