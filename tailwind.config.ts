import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d7fe',
          300: '#a5bbfc',
          400: '#8196f8',
          500: '#6272f1',
          600: '#4a51e5',
          700: '#3d41ca',
          800: '#3337a4',
          900: '#2e3382',
          950: '#1c1f4d',
        },
        surface: {
          50:  '#f8f9fc',
          100: '#1e2035',
          200: '#252842',
          300: '#2d3150',
          400: '#353860',
          500: '#3d4170',
          600: '#454a80',
          700: '#4d5290',
          800: '#1a1d2e',
          900: '#12141f',
          950: '#0a0b12',
        },
      },
      fontFamily: {
        sans:    ['var(--font-inter)', 'sans-serif'],
        syne:    ['var(--font-syne)', 'sans-serif'],
        display: ['var(--font-syne)', 'sans-serif'],
        mono:    ['var(--font-jetbrains)', 'monospace'],
      },
      animation: {
        'fade-in':    'fadeIn 0.5s ease-out',
        'slide-up':   'slideUp 0.4s ease-out',
        'pulse-slow': 'pulse 3s infinite',
        'spin-slow':  'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
export default config
