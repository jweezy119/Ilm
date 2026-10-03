/**
 * The fallback voice's contract with the rest of the app.
 *
 * Only the parts that can be wrong without a browser: the speed mapping, when the
 * fallback is offered at all, and the shape of the engine it loads. The engine
 * itself is a 1.8 MB bundle built by script, verified in a real browser in both
 * Chromium and Firefox — which is the point, because the version it replaces
 * played through a ScriptProcessorNode that Firefox has removed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wordsPerMinute, roboticVoicePossible, ENGINE_URL_HINT } from './robotic-voice';

describe('wordsPerMinute', () => {
  it('treats 1 as the default reading rate', () => {
    expect(wordsPerMinute(1)).toBe(175);
    expect(wordsPerMinute(undefined)).toBe(175);
  });

  it('scales with the speed control', () => {
    expect(wordsPerMinute(0.75)).toBe(131);
    expect(wordsPerMinute(1.25)).toBe(219);
  });

  it('stays inside what the engine accepts', () => {
    // meSpeak clamps to 80–450 and ignores anything outside, so an extreme
    // setting would appear to do nothing rather than being wrong out loud.
    expect(wordsPerMinute(0.1)).toBe(80);
    expect(wordsPerMinute(10)).toBe(450);
    expect(wordsPerMinute(0)).toBe(80);
    expect(wordsPerMinute(-1)).toBe(80);
  });
});

describe('roboticVoicePossible', () => {
  it('is false where there is no Web Audio, so it is never offered', () => {
    // Checked in node, where window does not exist at all.
    expect(roboticVoicePossible()).toBe(false);
  });
});

describe('how the engine is delivered', () => {
  /*
   * Comments stripped before anything is asserted. The file documents the
   * readiness bug by naming the functions it no longer calls, so asserting on the
   * raw text would forbid explaining it — and the api tests already read sources
   * this way for the same reason.
   */
  const code = readFileSync(resolve(__dirname, './robotic-voice.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('is loaded from our own origin, not a bundler or a third party', () => {
    /*
     * Next's bundler refuses to parse the engine at all, and the alternatives are
     * shipping 6 MB to everyone or pulling it from a CDN at the moment somebody is
     * relying on an accessibility feature.
     */
    expect(code).toContain(`const ENGINE_URL = '${ENGINE_URL_HINT}'`);
    expect(code).toContain("document.createElement('script')");
    expect(code).not.toMatch(/https?:\/\/(?!localhost)/);
    expect(code).not.toMatch(/import\(['"]mespeak/);
  });

  it('proves the engine works by making it speak, not by asking', () => {
    /*
     * There was a readiness flag taken from the engine's own isConfigLoaded() and
     * isVoiceLoaded('en') as soon as the script ran, and it was always false —
     * emscripten initialises asynchronously, so the dictionary is not registered
     * yet even though generate() works a moment later. Checking a flag rejected a
     * working engine and sent every reader back to the install-a-voice page.
     */
    expect(code).toContain('engine.generate(');
    // No *call* to them: the names appear in the comment explaining why, and in
    // the library's own API surface, so absence of the word would be a test that
    // forbids documenting the bug.
    expect(code).not.toMatch(/isConfigLoaded\s*\(/);
    expect(code).not.toMatch(/isVoiceLoaded\s*\(/);
    expect(code).not.toMatch(/engine\.ready/);
  });

  it('does not cache a failed load', () => {
    expect(code).toContain('loading = null;');
  });

  it('reports failure rather than leaving a button that does nothing', () => {
    expect(code).toContain('robotic voice: engine did not load');
    expect(code).toContain('robotic voice: engine loaded but produced no audio');
  });

  it('plays through current Web Audio, not the deprecated ScriptProcessor', () => {
    // ScriptProcessorNode is deprecated and removed from Firefox — which is one of
    // the two browsers most likely to have no voice installed.
    expect(code).toContain('createBufferSource()');
    expect(code).not.toContain('createScriptProcessor');
  });

  it('handles both forms of decodeAudioData, because Safari only has one', () => {
    expect(code).toMatch(/typeof \(maybe as Promise<AudioBuffer>\)\.then === 'function'/);
  });
});

describe('the bundled engine', () => {
  const artifact = resolve(__dirname, '../../public/vendor/ilm-robotic-voice.js');

  it('is committed, so a deploy cannot silently lose the fallback', () => {
    expect(readFileSync(artifact, 'utf8').length).toBeGreaterThan(0);
  });

  it('exposes generation on the global the page reads', () => {
    const bundle = readFileSync(artifact, 'utf8');
    expect(bundle).toContain('__ilmRoboticVoice');
    expect(bundle).toContain('generate');
  });

  it('carries its dictionary and voice inside it, so it is one request', () => {
    /*
     * Three requests while someone waits for speech is three ways to fail, and
     * this path runs on devices where things are already going wrong.
     *
     * Asserted on the voice's own payload rather than a language code: the bundle
     * is minified, and the identifier the engine registers is not the one in the
     * file name.
     */
    const bundle = readFileSync(artifact, 'utf8');
    expect(bundle).toContain('voice_id');
    // An engine alone is well under this; the dictionary and voice are the rest.
    expect(bundle.length).toBeGreaterThan(1024 * 1024);
    expect(bundle.length).toBeLessThan(4 * 1024 * 1024);
  });
});
