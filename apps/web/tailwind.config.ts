import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: 'class',
  content: ['./src/app/**/*.{js,ts,jsx,tsx,mdx}', './src/components/**/*.{js,ts,jsx,tsx,mdx}', './src/lib/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Semantic surfaces, all driven by CSS variables so that dark mode is one
        // switch instead of a `dark:` variant on every utility. That was the single
        // biggest source of visual inconsistency: a class could easily be written
        // for light mode and simply not restated for dark, and the result was a
        // panel that stayed white in a dark page.
        //
        // Named for what they are, not for what colour they are, so the markup
        // reads as `bg-panel text-fg-muted` rather than `bg-ink-100 text-ink-600`
        // and does not need changing when the palette does.
        bg: 'rgb(var(--bg) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-soft': 'rgb(var(--line-soft) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        'fg-faint': 'rgb(var(--fg-faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',

        // Ink and paper. Every page styles itself with these two names rather than
        // raw greys, and dark mode is reached by the `dark:` variants on each
        // utility — so these are one fixed scale, not a pair that swaps.
        //
        // The scale is deliberately the same in both modes: ink-800 is the dark
        // header in light mode and the panel background in dark mode, because the
        // markup asks for `bg-ink-800 dark:bg-ink-900` rather than for "the
        // inverted one". ink-700 matches --foreground in globals.css, which is why
        // body copy and `text-ink-700` read as the same colour.
        ink: {
          50: 'rgb(var(--fg-faint) / <alpha-value>)',
          100: 'rgb(var(--panel) / <alpha-value>)',
          200: 'rgb(var(--line) / <alpha-value>)',
          300: 'rgb(var(--line) / <alpha-value>)',
          400: 'rgb(var(--fg-faint) / <alpha-value>)',
          500: 'rgb(var(--fg-muted) / <alpha-value>)',
          600: 'rgb(var(--fg-muted) / <alpha-value>)',
          700: 'rgb(var(--fg) / <alpha-value>)',
          800: 'rgb(var(--fg) / <alpha-value>)',
          900: 'rgb(var(--fg) / <alpha-value>)',
          950: 'rgb(var(--fg) / <alpha-value>)',
        },
        // The page surface: warm cream, matching --background in globals.css, so
        // `bg-paper` and the body background are the same colour to the pixel.
        paper: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          50: 'rgb(var(--bg) / <alpha-value>)',
          100: 'rgb(var(--panel) / <alpha-value>)',
          200: 'rgb(var(--line-soft) / <alpha-value>)',
          500: 'rgb(var(--line) / <alpha-value>)',
          800: 'rgb(var(--fg) / <alpha-value>)',
          900: 'rgb(var(--fg) / <alpha-value>)',
          950: 'rgb(var(--bg) / <alpha-value>)',
        },
        // Ilm brand colors - deep, scholarly tones
        ilm: {
          50: '#f0f4f8',
          100: '#d9e2ec',
          200: '#bcccdc',
          300: '#9fb3c8',
          400: '#829ab1',
          500: '#627d98',
          600: '#486581',
          700: '#334e68',
          800: '#243b53',
          900: '#102a43',
          950: '#0c1e33',
        },
        // Text-specific accent colors
        quran: { DEFAULT: '#1a5c3e', light: '#e8f5ed', dark: '#0d3d24' },
        talmud: { DEFAULT: '#8b4513', light: '#fdf0e6', dark: '#5d2e0c' },
        torah: { DEFAULT: '#1e3a5f', light: '#e6ebf0', dark: '#0f2342' },
        ot: { DEFAULT: '#5c2a1a', light: '#f5ebe8', dark: '#3d1a10' },
        nt: { DEFAULT: '#3d1a5c', light: '#ebe8f5', dark: '#260f3d' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono2: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        arabic: ['var(--font-arabic)', 'Noto Naskh Arabic', 'serif'],
        hebrew: ['var(--font-hebrew)', 'Noto Sans Hebrew', 'serif'],
        greek: ['var(--font-greek)', 'Noto Serif', 'serif'],
      },
      typography: (theme: (path: string) => string) => ({
        DEFAULT: {
          css: {
            color: theme('colors.ilm.800'),
            maxWidth: 'none',
            a: { color: theme('colors.ilm.600'), textDecoration: 'none', '&:hover': { textDecoration: 'underline' } },
            blockquote: { borderLeftColor: theme('colors.ilm.300'), fontStyle: 'italic' },
            code: { backgroundColor: theme('colors.ilm.100'), padding: '0.125rem 0.375rem', borderRadius: '0.25rem' },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
          },
        },
      }),
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideDown: { '0%': { opacity: '0', transform: 'translateY(-10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.7' } },
      },
    },
  },
  plugins: [typography],
};

export default config;