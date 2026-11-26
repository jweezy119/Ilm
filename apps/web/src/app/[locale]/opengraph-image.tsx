import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * A card for shared links. Latin only: the default OG font has no reliable
 * Arabic or Hebrew coverage, and a card with tofu boxes is worse than one
 * language rendered cleanly. The app itself remains fully trilingual.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: '#fdfcfa',
          padding: 80,
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, color: '#065f46', letterSpacing: 4 }}>ILM</div>
        <div
          style={{
            display: 'flex',
            marginTop: 24,
            fontSize: 64,
            lineHeight: 1.1,
            color: '#1c1917',
            fontWeight: 600,
          }}
        >
          Read the texts.
        </div>
        <div style={{ display: 'flex', fontSize: 64, lineHeight: 1.1, color: '#1c1917', fontWeight: 600 }}>
          Draw your own conclusion.
        </div>
        <div style={{ display: 'flex', marginTop: 40, fontSize: 24, color: '#57534e' }}>
          Quran · Torah · Talmud · Testaments · Enoch
        </div>
      </div>
    ),
    size
  );
}
