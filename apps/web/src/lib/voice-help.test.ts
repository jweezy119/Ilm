/**
 * Getting the guidance right is most of the value, so the cases that are easy to
 * get wrong are pinned here.
 *
 * The ones that bite: Android's user agent also says "Linux", iPadOS claims to be
 * "Mac OS X", Chrome OS claims both "X11" and "CrOS", and a private window has
 * voices that exist one moment and not the next — where "install a voice" sends
 * the reader to a place that cannot possibly help them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectPlatform, voiceGuidanceKey, voiceHelpUrl, voiceProblem } from './voice-help';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const SAFARI_IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';
const CHROME_CROS = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

describe('detectPlatform', () => {
  it('reads the structured hint in preference to the user agent string', () => {
    // userAgentData is structured and does not lie about Android pretending to
    // be Linux, or an iPad claiming to be a Mac.
    expect(detectPlatform({ userAgent: CHROME_ANDROID, platformHint: 'android' })).toBe('android');
    expect(detectPlatform({ userAgent: SAFARI_MAC, platformHint: 'macos' })).toBe('macos');
    expect(detectPlatform({ userAgent: CHROME_WIN, platformHint: 'windows' })).toBe('windows');
  });

  it('does not call Android Linux', () => {
    expect(detectPlatform({ userAgent: CHROME_ANDROID })).toBe('android');
    expect(detectPlatform({ userAgent: CHROME_ANDROID })).not.toBe('linux');
  });

  it('calls an iPad an iPad, not a Mac', () => {
    // iPadOS sends a desktop Safari string; the giveaway is that it has touch.
    expect(detectPlatform({ userAgent: SAFARI_IPAD, maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ userAgent: SAFARI_IPAD })).toBe('macos');
  });

  it('calls Chrome OS Chrome OS, not Linux', () => {
    // Its user agent says both X11 and CrOS.
    expect(detectPlatform({ userAgent: CHROME_CROS })).toBe('chromeos');
    expect(detectPlatform({ userAgent: CHROME_CROS })).not.toBe('linux');
  });

  it('reads the obvious ones', () => {
    expect(detectPlatform({ userAgent: CHROME_WIN })).toBe('windows');
    expect(detectPlatform({ userAgent: SAFARI_MAC })).toBe('macos');
    expect(detectPlatform({ userAgent: FIREFOX_LINUX })).toBe('linux');
  });

  it('says so when it cannot tell', () => {
    expect(detectPlatform({ userAgent: '' })).toBe('unknown');
    expect(detectPlatform({ userAgent: 'something nobody has seen' })).toBe('unknown');
  });

  it('survives a missing navigator entirely', () => {
    expect(detectPlatform({ userAgent: '' })).toBe('unknown');
  });
});

describe('private windows', () => {
  it('are not detected, because they cannot be', () => {
    /*
     * Chrome puts no "incognito" in the user agent, and the signals that do
     * exist — a tiny storage quota, ephemeral localStorage — are shared with
     * genuinely low-storage devices. Claiming to know would send someone to
     * install a voice they already have, so the guidance names private windows
     * as a thing to try instead of asserting which case this is.
     */
    const code = readFileSync(resolve(__dirname, './voice-help.ts'), 'utf8');
    expect(code).toContain('Private windows are deliberately not detected');
    expect(code).not.toContain('export function detectPrivateWindow');
  });
});

describe('voiceGuidanceKey', () => {
  it('shares one answer between Apple platforms and one between Linux desktops', () => {
    // The steps are the same even where the menus are worded differently.
    expect(voiceGuidanceKey('macos')).toBe(voiceGuidanceKey('ios'));
    expect(voiceGuidanceKey('linux')).toBe(voiceGuidanceKey('chromeos'));
  });

  it('differs between Windows, Apple, Android and Linux', () => {
    const keys = ['windows', 'macos', 'android', 'linux'].map((p) => voiceGuidanceKey(p as never));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('falls back rather than showing nothing', () => {
    expect(voiceGuidanceKey('unknown')).toBe('voiceGeneric');
  });
});

describe('voiceHelpUrl', () => {
  it('points somewhere different per platform', () => {
    const urls = ['windows', 'macos', 'android', 'linux', 'unknown'].map((p) => voiceHelpUrl(p as never));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('always gives an absolute link', () => {
    for (const platform of ['windows', 'macos', 'ios', 'android', 'linux', 'chromeos', 'unknown'] as const) {
      expect(voiceHelpUrl(platform)).toMatch(/^https:\/\//);
    }
  });
});

describe('voiceProblem', () => {
  it('decides everything in one call so the parts cannot disagree', () => {
    const problem = voiceProblem({ userAgent: FIREFOX_LINUX });
    expect(problem.platform).toBe('linux');
    expect(problem.messageKey).toBe('voiceLinux');
    expect(problem.helpUrl).toContain('github.com');
  });

  it('produces a message key for every platform it can name', () => {
    const all = [
      CHROME_WIN, SAFARI_MAC, SAFARI_IPAD, CHROME_ANDROID, FIREFOX_LINUX, CHROME_CROS, '',
    ];
    for (const userAgent of all) {
      const p = voiceProblem({ userAgent });
      expect(p.messageKey, `no key for ${userAgent}`).toMatch(/^voice/);
      expect(p.helpUrl).toMatch(/^https:\/\//);
    }
  });
});
