// ============================================================================
// Flight Game — Renderer (render.js)
// Agent-authored rewrite.
//
// This module owns all Three.js rendering for the flight game:
//   * Scene, camera, lighting (ambient, sun directional, fill)
//   * Procedural ground tiles with per-tile colors and fog
//   * Runway geometry and markings
//   * Collectible rings (torus meshes)
//   * Buildings and trees
//   * Plane model (fuselage, nose, wings, tail, propeller, cockpit)
//   * Chase camera following the plane with lag
//   * HUD overlay (altitude, speed, heading, fuel, damage, mission text)
//   * Fixed-size draw loop reading world state
//
// Constants define the color palette for sky, ground, runway, rings, and plane.
// createRenderer(canvas) returns { draw, destroy, getCanvas }.
// ============================================================================

// Render: Three.js scene, plane model, terrain, rings, runway, sky, chase camera,
// HUD overlay. Reads world state, draws pixels. Agent-authored rewrite of the renderer module.

import * as THREE from '../../vendor/three.min.js';
import { FIELD, PLANE, CAMERA, WORLD, MISSION, SCREEN, HUD } from './config.js';

const COLOR_SKY_TOP = 0x1a3a5c;
const COLOR_SKY_HORIZON = 0x4a8cc9;
const COLOR_GROUND = 0x5a8a44;
const COLOR_GROUND_HIGH = 0x3a5a2a;
const COLOR_RUNWAY = 0x8a8a8a;
const COLOR_RUNWAY_EDGE = 0xffffff;
const COLOR_RING = 0xffaa00;
const COLOR_PLANE_BODY = 0x2a3a4a;
const COLOR_PLANE_WING = 0x4a5a6a;
const COLOR_PLANE_ACCENT = 0xff5522;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a3a5c, 0.0018);

  const camera = new THREE.PerspectiveCamera(55, 1, 1, 5000);

  // ---- Lighting ----
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(200, 300, 100);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1500;
  sun.shadow.camera.left = -700;
  sun.shadow.camera.right = 700;
  sun.shadow.camera.top = 700;
  sun.shadow.camera.bottom = -700;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x88aadd, 0.35);
  fill.position.set(-200, 100, -200);
  scene.add(fill);

  // Sun sprite
  const sunGeo = new THREE.SphereGeometry(14, 16, 16);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.position.copy(sun.position);
  scene.add(sunMesh);

  // ---- Ground (large plane, per-tile colors) ----
  const groundGroup = new THREE.Group();
  scene.add(groundGroup);

  const tileGeo = new THREE.PlaneGeometry(FIELD.tileSize, FIELD.tileSize);
  tileGeo.rotateX(-Math.PI / 2);
  const tileMat = new THREE.MeshStandardMaterial({ color: COLOR_GROUND, flatShading: true });
  const groundTiles = new Map();

  function ensureTile(x, z, height) {
    const key = `${x},${z}`;
    let mesh = groundTiles.get(key);
    if (!mesh) {
      mesh = new THREE.Mesh(tileGeo, tileMat);
      mesh.position.set(x, height, z);
      mesh.receiveShadow = true;
      groundGroup.add(mesh);
      groundTiles.set(key, mesh);
      if (groundTiles.size > 400) {
        const first = groundTiles.keys().next().value;
        const old = groundTiles.get(first);
        groundGroup.remove(old);
        groundTiles.delete(first);
      }
    }
    return mesh;
  }

  function updateGround(planeX, planeZ, getGroundHeight, getTerrainColor) {
    const gx = Math.floor(planeX / FIELD.tileSize) * FIELD.tileSize;
    const gz = Math.floor(planeZ / FIELD.tileSize) * FIELD.tileSize;
    const range = 4;
    for (let dx = -range; dx <= range; dx += 1) {
      for (let dz = -range; dz <= range; dz += 1) {
        const wx = gx + dx * FIELD.tileSize;
        const wz = gz + dz * FIELD.tileSize;
        const h = getGroundHeight(wx, wz);
        ensureTile(wx, wz, h);
        const c = getTerrainColor(wx, wz);
        const mesh = groundTiles.get(`${wx},${wz}`);
        if (mesh) mesh.material.color.setHex(c);
      }
    }
  }

  // ---- Runway ----
  const runwayGroup = new THREE.Group();
  scene.add(runwayGroup);

  const runwayGeo = new THREE.PlaneGeometry(600, 40);
  runwayGeo.rotateX(-Math.PI / 2);
  const runwayMat = new THREE.MeshStandardMaterial({ color: COLOR_RUNWAY });
  const runwayMesh = new THREE.Mesh(runwayGeo, runwayMat);
  runwayMesh.position.set(0, 0.51, 1200);
  runwayMesh.receiveShadow = true;
  runwayGroup.add(runwayMesh);

  const edgeGeo = new THREE.BoxGeometry(620, 1, 44);
  const edgeMat = new THREE.MeshStandardMaterial({ color: COLOR_RUNWAY_EDGE });
  const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
  edgeMesh.position.set(0, 0.55, 1200);
  runwayGroup.add(edgeMesh);

  // Runway numbers/markings
  const markGeo = new THREE.BoxGeometry(20, 0.6, 8);
  const markMat = new THREE.MeshStandardMaterial({ color: COLOR_RUNWAY_EDGE });
  for (let i = 0; i < 6; i += 1) {
    const mark = new THREE.Mesh(markGeo, markMat);
    mark.position.set(-220 + i * 80, 0.54, 1200 - i * 40);
    runwayGroup.add(mark);
  }

  function updateRunway(runway) {
    runwayGroup.position.set(runway.x, 0, runway.z);
    runwayGroup.rotation.y = runway.heading;
  }

  // ---- Rings ----
  const ringGroup = new THREE.Group();
  scene.add(ringGroup);

  const ringGeo = new THREE.TorusGeometry(MISSION.ringRadius, 2, 8, 24);
  const ringMat = new THREE.MeshStandardMaterial({ color: COLOR_RING, emissive: 0x331100 });
  const ringMeshes = [];

  function createRingMesh(x, y, z) {
    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.position.set(x, y, z);
    ringGroup.add(mesh);
    ringMeshes.push(mesh);
    return mesh;
  }

  function updateRings(rings) {
    // Remove old
    while (ringMeshes.length > 0) {
      const m = ringMeshes.pop();
      ringGroup.remove(m);
    }
    for (const ring of rings) {
      createRingMesh(ring.x, ring.y, ring.z);
    }
  }

  // ---- Buildings ----
  const buildingGroup = new THREE.Group();
  scene.add(buildingGroup);
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMats = [
    new THREE.MeshStandardMaterial({ color: 0x556644 }),
    new THREE.MeshStandardMaterial({ color: 0x445533 }),
    new THREE.MeshStandardMaterial({ color: 0x667755 }),
  ];
  const buildingMeshes = [];

  function createBuildingMesh(b) {
    const mesh = new THREE.Mesh(buildingGeo, buildingMats[Math.floor(Math.random() * buildingMats.length)]);
    mesh.scale.set(b.width, b.height, b.depth);
    mesh.position.set(b.x, b.height / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    buildingGroup.add(mesh);
    buildingMeshes.push(mesh);
  }

  function updateBuildings(buildings) {
    while (buildingMeshes.length > 0) {
      const m = buildingMeshes.pop();
      buildingGroup.remove(m);
    }
    for (const b of buildings) createBuildingMesh(b);
  }

  // ---- Trees ----
  const treeGroup = new THREE.Group();
  scene.add(treeGroup);
  const treeTrunkGeo = new THREE.CylinderGeometry(0.6, 0.9, 6, 8);
  const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f });
  const treeTopGeo = new THREE.ConeGeometry(3, 8, 8);
  const treeTopMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
  const treeMeshes = [];

  function createTreeMesh(t) {
    const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
    trunk.position.set(t.x, 3, t.z);
    trunk.castShadow = true;
    trunk.receiveShadow = true;

    const top = new THREE.Mesh(treeTopGeo, treeTopMat);
    top.position.set(t.x, t.height - 2, t.z);
    top.castShadow = true;

    treeGroup.add(trunk);
    treeGroup.add(top);
    treeMeshes.push(trunk, top);
  }

  function updateTrees(trees) {
    while (treeMeshes.length > 0) {
      const m = treeMeshes.pop();
      treeGroup.remove(m);
    }
    for (const t of trees) createTreeMesh(t);
  }

  // ---- Plane model ----
  const planeGroup = new THREE.Group();
  scene.add(planeGroup);

  const fuselageGeo = new THREE.CylinderGeometry(1.4, 1.0, 16, 12);
  const fuselageMat = new THREE.MeshStandardMaterial({ color: COLOR_PLANE_BODY });
  const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.castShadow = true;
  planeGroup.add(fuselage);

  const noseGeo = new THREE.ConeGeometry(1.0, 3, 12);
  const nose = new THREE.Mesh(noseGeo, fuselageMat);
  nose.position.set(9, 0, 0);
  nose.rotation.z = Math.PI / 2;
  nose.castShadow = true;
  planeGroup.add(nose);

  const wingGeo = new THREE.BoxGeometry(22, 0.5, 3);
  const wingMat = new THREE.MeshStandardMaterial({ color: COLOR_PLANE_WING });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.position.set(0, 0.2, 0);
  wing.castShadow = true;
  planeGroup.add(wing);

  const tailGeo = new THREE.BoxGeometry(6, 0.4, 5);
  const tailMat = new THREE.MeshStandardMaterial({ color: COLOR_PLANE_WING });
  const tail = new THREE.Mesh(tailGeo, tailMat);
  tail.position.set(-8, 1.6, 0);
  tail.castShadow = true;
  planeGroup.add(tail);

  const vtailGeo = new THREE.BoxGeometry(0.4, 5, 3);
  const vtail = new THREE.Mesh(vtailGeo, tailMat);
  vtail.position.set(-8, 4.2, 0);
  vtail.castShadow = true;
  planeGroup.add(vtail);

  const propGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8);
  const propMat = new THREE.MeshStandardMaterial({ color: COLOR_PLANE_ACCENT });
  const propeller = new THREE.Mesh(propGeo, propMat);
  propeller.position.set(10.6, 0, 0);
  propeller.rotation.z = Math.PI / 2;
  planeGroup.add(propeller);

  const cockpitGeo = new THREE.SphereGeometry(0.9, 10, 10);
  const cockpitMat = new THREE.MeshStandardMaterial({ color: 0xbbddff, transparent: true, opacity: 0.6 });
  const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
  cockpit.position.set(1, 0.4, 0);
  planeGroup.add(cockpit);

  // ---- Chase camera target ----
  let cameraTarget = { x: 0, y: 0, z: 0 };

  // ---- HUD overlay (HTML/CSS on top of canvas) ----
  const hud = document.createElement('div');
  hud.id = 'flight-hud';
  hud.style.position = 'absolute';
  hud.style.inset = '0';
  hud.style.pointerEvents = 'none';
  hud.style.fontFamily = "'Courier New', Courier, monospace";
  hud.style.color = '#e8f4ff';
  hud.style.zIndex = '10';

  const altEl = document.createElement('div');
  altEl.style.position = 'absolute';
  altEl.style.left = HUD.margin + 'px';
  altEl.style.top = HUD.margin + 'px';
  altEl.style.fontSize = HUD.fontSizeLarge + 'px';
  altEl.style.fontWeight = 'bold';
  altEl.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
  hud.appendChild(altEl);

  const spdEl = document.createElement('div');
  spdEl.style.position = 'absolute';
  spdEl.style.left = HUD.margin + 'px';
  spdEl.style.top = (HUD.margin + 40) + 'px';
  spdEl.style.fontSize = HUD.fontSize + 'px';
  spdEl.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
  hud.appendChild(spdEl);

  const hdgEl = document.createElement('div');
  hdgEl.style.position = 'absolute';
  hdgEl.style.right = HUD.margin + 'px';
  hdgEl.style.top = HUD.margin + 'px';
  hdgEl.style.fontSize = HUD.fontSizeLarge + 'px';
  hdgEl.style.fontWeight = 'bold';
  hdgEl.style.textAlign = 'right';
  hdgEl.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
  hud.appendChild(hdgEl);

  const fuelEl = document.createElement('div');
  fuelEl.style.position = 'absolute';
  fuelEl.style.right = HUD.margin + 'px';
  fuelEl.style.top = (HUD.margin + 40) + 'px';
  fuelEl.style.fontSize = HUD.fontSize + 'px';
  fuelEl.style.textAlign = 'right';
  fuelEl.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
  hud.appendChild(fuelEl);

  const dmgEl = document.createElement('div');
  dmgEl.style.position = 'absolute';
  dmgEl.style.left = HUD.margin + 'px';
  dmgEl.style.bottom = HUD.margin + 'px';
  dmgEl.style.fontSize = HUD.fontSize + 'px';
  dmgEl.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
  hud.appendChild(dmgEl);

  const missionEl = document.createElement('div');
  missionEl.style.position = 'absolute';
  missionEl.style.left = '50%';
  missionEl.style.top = HUD.margin + 'px';
  missionEl.style.transform = 'translateX(-50%)';
  missionEl.style.fontSize = HUD.fontSizeLarge + 'px';
  missionEl.style.fontWeight = 'bold';
  missionEl.style.textAlign = 'center';
  missionEl.style.textShadow = '0 0 8px rgba(0,0,0,0.9)';
  hud.appendChild(missionEl);

  // Crosshair
  const crosshair = document.createElement('div');
  crosshair.style.position = 'absolute';
  crosshair.style.left = '50%';
  crosshair.style.top = '50%';
  crosshair.style.width = '16px';
  crosshair.style.height = '16px';
  crosshair.style.border = '2px solid rgba(255,255,255,0.4)';
  crosshair.style.borderRadius = '50%';
  crosshair.style.transform = 'translate(-50%, -50%)';
  crosshair.style.pointerEvents = 'none';
  hud.appendChild(crosshair);

  canvas.parentNode.appendChild(hud);

  // ---- Resize ----
  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Draw ----
  let lastRingUpdate = 0;

  return {
    draw(state, screen, input) {
      const p = state.plane;
      const t = state.time;

      // Update ground near plane
      updateGround(p.x, p.z, state.getGroundHeight, state.getTerrainColor);

      // Update rings when they change
      if (t - lastRingUpdate > 0.1) {
        updateRings(state.rings);
        updateBuildings(state.buildings);
        updateTrees(state.trees);
        lastRingUpdate = t;
      }

      updateRunway(state.runway);

      // Sun position follows camera-ish (fixed in world)
      sunMesh.position.set(p.x + 200, p.y + 300, p.z + 100);
      sun.position.copy(sunMesh.position);

      // Plane model transform
      planeGroup.position.set(p.x, p.y, p.z);
      planeGroup.rotation.set(p.pitch, p.yaw, p.roll);
      propeller.rotation.z = p.propellerAngle;
      propeller.rotation.x = Math.PI / 2;

      // Damage flicker
      if (p.damage > 50 && Math.floor(t * 10) % 2 === 0) {
        fuselage.material.emissive.setHex(0x440000);
      } else {
        fuselage.material.emissive.setHex(0x000000);
      }

      // Chase camera
      const idealX = p.x - Math.sin(p.yaw) * CAMERA.chaseDistance * Math.cos(p.pitch);
      const idealY = p.y + CAMERA.chaseHeight + Math.sin(p.pitch) * CAMERA.chaseDistance;
      const idealZ = p.z - Math.cos(p.yaw) * CAMERA.chaseDistance * Math.cos(p.pitch);

      cameraTarget.x += (idealX - cameraTarget.x) * CAMERA.chaseLag;
      cameraTarget.y += (idealY - cameraTarget.y) * CAMERA.chaseLag;
      cameraTarget.z += (idealZ - cameraTarget.z) * CAMERA.chaseLag;

      camera.position.set(cameraTarget.x, cameraTarget.y, cameraTarget.z);
      const lookX = p.x - Math.sin(p.yaw) * CAMERA.lookAhead * Math.cos(p.pitch);
      const lookY = p.y + Math.sin(p.pitch) * CAMERA.lookAhead;
      const lookZ = p.z - Math.cos(p.yaw) * CAMERA.lookAhead * Math.cos(p.pitch);
      camera.lookAt(lookX, lookY, lookZ);

      // HUD text
      const headingDeg = Math.round(((p.yaw * 180 / Math.PI) + 360) % 360);
      altEl.textContent = `ALT ${Math.floor(p.altitude)} ft`;
      spdEl.textContent = `SPD ${Math.floor(p.speed)} kt`;
      hdgEl.textContent = `HDG ${headingDeg}°`;
      fuelEl.textContent = `FUEL ${Math.floor((p.fuel / PLANE.fuelCapacity) * 100)}%`;
      dmgEl.textContent = `DMG ${Math.floor(p.damage)}%`;

      if (state.mission === 'rings') {
        missionEl.textContent = `RINGS: ${state.ringsPassed} / ${MISSION.ringsPerMission}`;
      } else if (state.mission === 'land') {
        missionEl.textContent = 'LAND ON RUNWAY AHEAD';
      } else if (state.missionComplete) {
        missionEl.textContent = 'MISSION COMPLETE';
      }

      renderer.render(scene, camera);
    },

    destroy() {
      window.removeEventListener('resize', resize);
      canvas.parentNode.removeChild(hud);
    },

    getCanvas() { return canvas; },
  };
}

// ---- Debug stats overlay (agent-authored addition) ----
// Renders a small text panel with frame time, plane speed, altitude, and damage.
// Updated once per second to avoid DOM thrashing.
export function createDebugStats(canvas) {
  const panel = document.createElement('div');
  panel.style.position = 'absolute';
  panel.style.left = '10px';
  panel.style.top = '10px';
  panel.style.fontFamily = "'Courier New', Courier, monospace";
  panel.style.fontSize = '12px';
  panel.style.color = '#00ff00';
  panel.style.background = 'rgba(0, 0, 0, 0.6)';
  panel.style.padding = '8px';
  panel.style.borderRadius = '4px';
  panel.style.pointerEvents = 'none';
  panel.style.zIndex = '100';
  panel.style.display = 'none';
  canvas.parentNode.appendChild(panel);

  let lastTime = performance.now();
  let frames = 0;
  let fps = 0;

  return {
    show() { panel.style.display = 'block'; },
    hide() { panel.style.display = 'none'; },
    update(plane) {
      frames += 1;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = now;
      }
      panel.textContent =
        `FPS: ${fps}\n` +
        `SPD: ${Math.floor(plane.speed)} kt\n` +
        `ALT: ${Math.floor(plane.altitude)} ft\n` +
        `DMG: ${Math.floor(plane.damage)}%\n`;
    },
    destroy() {
      canvas.parentNode.removeChild(panel);
    },
  };
}

// ---- Agent-authored additions: screen shake effect ----
// Applies a decaying camera offset when the plane crashes or takes damage.
// Called each frame from the draw loop; the offset fades toward zero.
export class ScreenShake {
  constructor() {
    this.intensity = 0;
    this.duration = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  trigger(intensity, duration) {
    this.intensity = intensity;
    this.duration = duration;
  }

  update(dt) {
    if (this.duration > 0) {
      this.duration -= dt;
      const shake = Math.random() * 2 - 1;
      this.offsetX = shake * this.intensity;
      this.offsetY = shake * this.intensity;
      this.intensity *= 0.9;
      if (this.duration <= 0) {
        this.offsetX = 0;
        this.offsetY = 0;
        this.intensity = 0;
      }
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  apply(camera) {
    camera.position.x += this.offsetX;
    camera.position.y += this.offsetY;
  }
}

// ---- Agent-authored additions: hit flash overlay ----
// Full-screen red flash that fades out after taking damage.
export function createHitFlash(canvas) {
  const flash = document.createElement('div');
  flash.style.position = 'absolute';
  flash.style.top = '0';
  flash.style.left = '0';
  flash.style.width = '100%';
  flash.style.height = '100%';
  flash.style.background = 'rgba(255, 0, 0, 0)';
  flash.style.pointerEvents = 'none';
  flash.style.zIndex = '200';
  flash.style.transition = 'background 0.15s linear';
  canvas.parentNode.appendChild(flash);

  let alpha = 0;

  return {
    trigger(amount) {
      alpha = Math.min(1, alpha + amount * 0.3);
      flash.style.background = `rgba(255, 0, 0, ${alpha})`;
    },
    update(dt) {
      if (alpha > 0) {
        alpha = Math.max(0, alpha - dt * 2);
        flash.style.background = `rgba(255, 0, 0, ${alpha})`;
      }
    },
    destroy() {
      canvas.parentNode.removeChild(flash);
    },
  };
}
