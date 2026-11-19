import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The compare tray is the one control that is available everywhere, so a
 * broken one breaks the whole comparison flow rather than a single page.
 *
 * These check the join between the three pieces that have to agree: the drag
 * payload set by the result row, the payload accepted by the tray, and the
 * global mount. They also guard the two presentation rules that make it work
 * on a phone: the safe-area inset, and raising the podcast player so the tray
 * never sits underneath another fixed control.
 */
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const tray = read('components/CompareTray.tsx');
const card = read('components/PassageCard.tsx');
const providers = read('components/Providers.tsx');
const podcast = read('components/GlobalPodcastPlayer.tsx');
const sidebar = read('components/GlobalAiSidebar.tsx');

describe('comparison tray', () => {
  it('is mounted once for the whole app, not per page', () => {
    expect(providers).toContain('<CompareTray />');
  });

  it('uses one drag payload on both ends', () => {
    expect(tray).toContain("export const PASSAGE_DRAG_TYPE = 'application/x-ilm-passage'");
    expect(card).toContain('PASSAGE_DRAG_TYPE');
    expect(tray).toContain('getData(PASSAGE_DRAG_TYPE)');
    expect(tray).toContain('addKey(key)');
  });

  it('keeps the click and keyboard path as well as dragging', () => {
    expect(card).toContain('onClick={() => onToggleCompare(passage)}');
    expect(card).toContain('aria-pressed={inComparison}');
    expect(card).toContain('draggable={canDrag}');
    expect(read('lib/useMediaQuery.ts')).toContain("FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'");
  });

  it('clears the bottom edge on a notched phone and docks on desktop', () => {
    expect(tray).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(tray).toContain('md:left-1/2');
  });

  it('does not stack the tray under the other fixed controls', () => {
    expect(tray).toContain("pathname === '/compare'");
    expect(podcast).toContain("trayCount > 0 ? 'bottom-24' : 'bottom-4'");
    expect(sidebar).toContain("trayCount > 0 ? 'bottom-40' : 'bottom-32'");
  });

  it('is localised in every catalogue', () => {
    for (const locale of ['en', 'he', 'ar']) {
      const messages = JSON.parse(read(`../messages/${locale}.json`));
      expect(messages.compareTray.open, `${locale} has no tray label`).toBeTruthy();
      expect(messages.compareTray.dropHere, `${locale} has no drop hint`).toBeTruthy();
    }
  });
});
