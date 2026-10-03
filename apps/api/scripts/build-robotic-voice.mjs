/**
 * Build the fallback voice into a single self-contained file.
 *
 * ## Why this is built rather than imported
 *
 * meSpeak's engine glue is 4.9 MB of emscripten output. Next's bundler refuses to
 * parse it — "Reading source code for parsing failed" — so importing it from the
 * app is not an option, and the obvious workarounds are all worse: shipping 6 MB
 * to readers who mostly never need it, or pulling it from a CDN at the moment
 * somebody is relying on an accessibility feature.
 *
 * So it is bundled here, once, into one file on our own origin, loaded on demand.
 * A reader whose browser has a voice never fetches it.
 *
 * ## Why one file
 *
 * The dictionary and the voice are inlined rather than fetched at runtime.
 * Three requests while someone waits for speech is three ways to fail, and the
 * whole point is that this path runs on devices where things are already going
 * wrong. One file, one load, then it works or it does not.
 *
 * Output is committed: this runs by hand when meSpeak is upgraded, not on every
 * build, so a dependency bump cannot silently change what ships.
 */

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..'); // apps/api/scripts -> repo root
const outFile = resolve(repo, 'apps/web/public/vendor/ilm-robotic-voice.js');

/**
 * The entry that gets bundled.
 *
 * Written to a temporary file rather than kept as a source module because it is
 * not something the app should ever import: it exists to become a plain script
 * with one global, and importing it would put 6 MB back on the bundler's path.
 */
const entry = `
import mespeak from 'mespeak';
import config from 'mespeak/src/mespeak_config.json';
import voice from 'mespeak/voices/en/en.json';

mespeak.loadConfig(config);
mespeak.loadVoice(voice);

/*
 * No readiness flag.
 *
 * There was one, computed from isConfigLoaded() and isVoiceLoaded('en') as soon
 * as the script ran, and it was always false: emscripten initialises its module
 * asynchronously, so the dictionary is not registered yet at that instant — even
 * though generate() works perfectly and returns audio a moment later. Checking
 * readiness there rejected a working engine and sent every reader back to the
 * install-a-voice page.
 *
 * So readiness is established by generating a few words instead, which is the
 * thing that actually has to work.
 */
globalThis.__ilmRoboticVoice = {
  /** WAV bytes for one line of text, or null when nothing was generated. */
  generate(text, speed) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const data = mespeak.speak(text, {
      rawdata: true,
      lang: 'en',
      speed,
      pitch: 50,
      amplitude: 100,
      wordgap: 0,
    });
    return data instanceof ArrayBuffer ? data : null;
  },
};
`;

const entryFile = resolve(repo, '.robotic-voice-entry.mjs');
writeFileSync(entryFile, entry, 'utf8');

try {
  const result = await build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'iife',
    minify: true,
    target: ['es2020'],
    write: false,
    legalComments: 'none',
    logLevel: 'error',
  });

  const [output] = result.outputFiles;
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, output.text, 'utf8');

  const kb = Math.round(output.text.length / 1024);
  console.log(`built ${outFile}`);
  console.log(`  ${kb} KB, fetched only when a reader has no device voice and asks for audio`);
} finally {
  // The entry is scaffolding for this script and must not be left behind to be
  // picked up by a typecheck or a bundler later.
  try {
    (await import('node:fs')).unlinkSync(entryFile);
  } catch {
    // Already gone, which is the state being asked for.
  }
}
