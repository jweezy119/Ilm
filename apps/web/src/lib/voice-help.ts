/**
 * Telling someone why their browser cannot speak, and what to do about it.
 *
 * "This browser has no speech voice installed" is accurate and useless. The
 * reader pressed a button on a scripture app, and the answer tells them nothing
 * they can act on and nothing about which of several different fixes they need.
 * Which depends entirely on their machine: Windows needs a voice added in
 * Settings, macOS needs one downloaded in Accessibility, Android needs Google
 * Speech Services installed, Linux needs speech-dispatcher present, and a private
 * window can lose voices that are otherwise there.
 *
 * So the answer names the platform and gives that platform's step.
 *
 * Detected rather than guessed where possible. There is no API for "which OS",
 * but `userAgentData` is structured and preferred when present, and the
 * `navigator.userAgent` string is the fallback; either way this is a hint, not a
 * fact, and the guidance is written so being slightly wrong is harmless. It is
 * never used to decide behaviour — only which sentence to show.
 */

export type VoicePlatform =
  | 'windows'
  | 'macos'
  | 'ios'
  | 'android'
  | 'linux'
  | 'chromeos'
  | 'unknown';

export interface VoiceEnvironment {
  userAgent: string;
  /** Present in Chromium browsers; structured and more trustworthy. */
  platformHint?: string;
  /** Chromium only. */
  brands?: Array<{ brand: string; version: string }>;
  /** The giveaway that an iPad is an iPad and not a Mac. */
  maxTouchPoints?: number;
}

/**
 * The platform, best guess available.
 *
 * Order matters: Android's user agent also says "Linux", iPadOS says "Mac OS X"
 * while actually being iOS, and Chrome OS says both "X11" and "CrOS".
 */
export function detectPlatform(env: VoiceEnvironment): VoicePlatform {
  const ua = (env.userAgent ?? '').toLowerCase();
  const hint = (env.platformHint ?? '').toLowerCase();

  if (hint === 'windows') return 'windows';
  if (hint === 'macos') return 'macos';
  if (hint === 'android') return 'android';
  if (hint === 'chrome os' || hint === 'chromeos') return 'chromeos';

  if (ua.includes('android')) return 'android';
  if (ua.includes('cros')) return 'chromeos';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  // iPadOS reports a desktop Safari string; touch points are the giveaway.
  if ((env.maxTouchPoints ?? 0) > 1 && ua.includes('mac')) return 'ios';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return 'unknown';
}

/*
 * Private windows are deliberately not detected.
 *
 * It looks detectable and is not: Chrome does not put "incognito" in the user
 * agent at all, and the signals that do exist — a tiny storage quota, ephemeral
 * localStorage — are shared with genuinely low-storage devices. Guessing wrong
 * here is worse than not answering, because it sends someone to install a voice
 * they already have. So the guidance mentions private windows as one thing to try
 * rather than asserting which case this is.
 */

/**
 * The message key for this platform, and the steps it should name.
 *
 * Returned as a key rather than a sentence so the wording lives in the message
 * catalogues and can be translated — which is the whole reason not to build the
 * sentence here.
 */
export function voiceGuidanceKey(platform: VoicePlatform): string {
  switch (platform) {
    case 'windows':
      return 'voiceWindows';
    case 'macos':
    case 'ios':
      return 'voiceApple';
    case 'android':
      return 'voiceAndroid';
    case 'linux':
    case 'chromeos':
      return 'voiceLinux';
    default:
      return 'voiceGeneric';
  }
}

/** The link that most likely gets a reader to the right instructions. */
export function voiceHelpUrl(platform: VoicePlatform): string {
  switch (platform) {
    case 'windows':
      return 'https://support.microsoft.com/office/add-a-voice-in-windows-10-ea3823c5-9912-4c77-b1a6-8fbd0cc9d938';
    case 'macos':
    case 'ios':
      return 'https://support.apple.com/guide/mac-help/speak-text-mh35859/mac';
    case 'android':
      return 'https://support.google.com/accessibility/android/answer/7349565';
    case 'linux':
    case 'chromeos':
      return 'https://github.com/braille-apps/gnome-speech/wiki/Setup';
    default:
      return 'https://support.mozilla.org/kb/how-to-make-firefox-speak';
  }
}

/** Everything the notice needs, decided in one place so it cannot disagree. */
export function voiceProblem(env: VoiceEnvironment): {
  platform: VoicePlatform;
  messageKey: string;
  helpUrl: string;
} {
  const platform = detectPlatform(env);
  return {
    platform,
    messageKey: voiceGuidanceKey(platform),
    helpUrl: voiceHelpUrl(platform),
  };
}
