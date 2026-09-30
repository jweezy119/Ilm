/**
 * Generate the PWA/TWA icon set from the app's own SVG.
 *
 * There is one source of truth for the icon — src/app/icon.svg — and these are
 * rasterised from it rather than drawn separately, because a second drawing of the
 * same mark is a second thing to keep in step.
 *
 * The maskable variant is not just a resize. Android crops a maskable icon to
 * whatever shape the launcher's mask is — a circle, a squircle, a teardrop — and it
 * can cut up to a quarter of the width off each side. Content within the central
 * 80% survives; anything touching the edge does not. So the maskable file is the
 * mark inset into a full-bleed background at 60%, which keeps the whole glyph inside
 * the safe zone under the roundest mask.
 *
 *   npx tsx scripts/generate-pwa-icons.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(__dirname, '..', 'public');
const SOURCE = join(__dirname, '..', 'src', 'app', 'icon.svg');

/** The green from the SVG, which is also the dark theme's brand colour. */
const BACKGROUND = '#065f46';

async function main(): Promise<void> {
  const svg = readFileSync(SOURCE, 'utf8');

  // The stock icon renders as-is at the standard sizes.
  for (const size of [192, 512]) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(OUT, `icon-${size}.png`));
    console.log(`  icon-${size}.png`);
  }

  // Maskable: the mark, inset, on a background that reaches the edges.
  const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <g transform="translate(102.4 102.4) scale(0.6)">${svg.replace(/<\/?svg[^>]*>/g, '')}</g>
</svg>`;
  await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile(join(OUT, 'icon-maskable-512.png'));
  console.log('  icon-maskable-512.png');

  // iOS does not read the manifest, and takes its home-screen icon from this file.
  // Without it an installed iOS shortcut gets a screenshot of the page.
  await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(join(OUT, 'apple-touch-icon.png'));
  console.log('  apple-touch-icon.png');

  writeFileSync(
    join(OUT, 'icon-source.svg'),
    `${svg}\n<!-- Rasterised into icon-192/512, icon-maskable-512 and apple-touch-icon by scripts/generate-pwa-icons.ts. -->\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});