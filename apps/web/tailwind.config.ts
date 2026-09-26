import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
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
        sans: ['Inter', 'system-ui', 'sans-serif'],
        arabic: ['Amiri', 'Noto Naskh Arabic', 'serif'],
        hebrew: ['Frank Ruehl', 'Noto Sans Hebrew', 'serif'],
        greek: ['GFS Neohellenic', 'Noto Sans Greek', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      typography: (theme: any) => ({
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
  plugins: [
    require('@tailwindcss/typography'),
  ],
};

export default config;