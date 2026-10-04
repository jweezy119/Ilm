/**
 * Arabic, then the English meaning — and the decisions that are easy to get wrong.
 *
 * The sequence itself is verified in a real browser, because it depends on an
 * audio element ending and a speech engine taking over. What is pinned here is
 * what a test can pin: that a translation is optional, that a failure to speak it
 * is not a failure of the passage, and that the reasons for saying something are
 * the ones that exist.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) =>
  readFileSync(resolve(__dirname, f), 'utf8')
    // Comments stripped so documenting a removed thing is not the same as calling it.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const player = read('../components/RecitationPlayer.tsx');
/*
 * Recording-or-synthesis moved into one hook when recorded English arrived, and
 * these assertions follow it there. They used to pin the player, which is what
 * let them catch the move.
 */
const voice = read('./english-voice.ts');

describe('the translation rides with the verse', () => {
  it('is optional, so the player still works for recitation alone', () => {
    expect(player).toMatch(/translation\?: string;/);
    expect(player).toContain('if (!verse?.translation) return false;');
  });

  it('is spoken after the recording ends, not on a second press', () => {
    // The handoff is the whole point. A reader who cannot read Arabic is played the
    // verse and then told what it means.
    expect(player).toContain('const onEnded = useCallback');
    expect(player).toMatch(/onEnded[\s\S]{0,400}speakTranslation\(index\)/);
    expect(player).toContain('<audio');
  });

  it('resolves a voice only once the Arabic has finished', () => {
    /*
     * Preparing a voice during the recitation is work that may never be needed —
     * if the passage turns out to have a recording, no synthesiser is wanted at
     * all, and on the first press that would mean loading 1.8 MB before the
     * Arabic has even started.
     */
    expect(player).toContain('await speakTranslation(index)');
    expect(player).not.toMatch(/createSpeechEngine/);
    expect(voice).toContain('recordedFor');
  });
});

describe('when it goes wrong', () => {
  it('keeps playing the passage when the translation cannot be spoken', () => {
    /*
     * The recording is a human voice and needs no synthesis at all. A reader with
     * no speech engine still gets the Arabic, so the explanation is a courtesy —
     * losing it must not drop them out of the passage they asked for.
     */
    expect(player).toContain('if (!spoke && verses[index]?.translation)');
    expect(player).not.toMatch(/setPlaying\(false\)[\s\S]{0,120}englishUnavailable/);
  });

  it('reports a missing voice once, and says the Arabic is unaffected', () => {
    expect(player).toContain("s('englishFailed')");
    // A passage with no recording yet is expected while the corpus is generated
    // in stages, so it must not be reported as an error — only as a fallback.
    expect(voice).toContain('isMissingAudio');
    expect(voice).toMatch(/onError\?\.\(error\)/);
  });

  it('repeats the Arabic alone when asked to repeat one verse', () => {
    // Someone who asks for the verse again wants the verse, not the explanation.
    const tail = player.slice(player.indexOf("if (repeat === 'one')"));
    expect(tail.slice(0, 400)).toContain('el.play()');
    expect(tail.slice(0, 400)).not.toContain('speakTranslation');
  });
});

describe('the transport stays one control', () => {
  it('stops the English when skipping', () => {
    // Otherwise the two halves talk over each other.
    expect(player).toMatch(/const go = useCallback\([\s\S]{0,200}english\.stop\(\)/);
  });

  it('stops the English on unmount and on a verse change', () => {
    expect(player).toMatch(/return \(\) => \{[\s\S]{0,220}english\.stop\(\)/);
    expect(voice).toContain('useEffect(() => stop, [stop])');
  });

  it('tells the listener which half is sounding', () => {
    // A reader needs to know why there is silence after the Arabic and before the
    // English, and the phase is otherwise invisible.
    expect(player).toContain("phase === 'english'");
    expect(player).toContain("phase === 'arabic'");
  });

  it('explains the sequence only where there is a translation', () => {
    // Otherwise the explanation appears on passages that never had one.
    expect(player).toContain('hasTranslation && !phase && !englishNotice');
  });
});
describe('a voice that has gone stale', () => {
  const engine = readFileSync(resolve(__dirname, './speech-engine.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('is not allowed to stop the queue in silence', () => {
    /*
     * Found in a browser, not by reading: the utterance's `voice` setter validates
     * its argument and the voice list changes while a page is open. The throw
     * escaped through the speech API's own promise chain, so a reader heard the
     * Arabic and then nothing — no error, no notice.
     */
    expect(engine).toMatch(/try \{\s*utterance\.voice = voice/);
  });

  it('still names the language, so the browser reads the right text', () => {
    expect(engine).toContain("utterance.lang = voice?.lang ?? 'en'");
  });
});
