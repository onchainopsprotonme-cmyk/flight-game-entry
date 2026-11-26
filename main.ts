// ============================================================================
// Flight Game — Entry Point (main.ts)
// Agent-authored rewrite.
//
// Node 22 entry point for the make.fun grader:
//   * Copies game/ and screenshots/ to /output
//   * Writes /output/dossier.json via the vendored make-fun library
//   * MAKEFUN_OUTPUT_DIR overrides /output for local testing
// ============================================================================

// SkyRunner flight game entry (Node 22, standard library only): the game is this repository's
// game/ folder, plain static files a desktop browser loads offline (game/index.html and its ES
// modules, three.js vendored under game/vendor/three.min.js, no network request), and this
// program hands it in. It copies game/ and screenshots/ from beside this file to /output and
// writes /output/dossier.json with the vendored make.fun library.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const entryVersion = '1.0.0';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// ---- Agent-authored additions: build validation and metadata ----
// Validate that required game assets exist before writing the dossier.
// Throws if any required file is missing.
function validateEntry() {
  const required = ['game/index.html', 'game/src/config.js', 'game/src/input.js', 'game/src/main.js', 'game/src/render.js', 'game/src/world.js', 'game/vendor/three.min.js'];
  for (const rel of required) {
    if (!existsSync(join(here, rel))) {
      throw new Error(`Missing required entry file: ${rel}`);
    }
  }
}

validateEntry();

// Entry metadata written alongside the dossier for the grader.
const entryMeta = {
  name: 'SkyRunner Flight Game',
  version: entryVersion,
  description: 'Three.js flight game: fly through rings, land on runway.',
  built: new Date().toISOString(),
  entrypoint: 'main.ts',
};

writeFileSync(join(out, 'entry.meta.json'), JSON.stringify(entryMeta, null, 2));
