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
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        accent: {
          purple: '#7c3aed',
          blue:   '#2563eb',
          cyan:   '#06b6d4',
          green:  '#10b981',
          red:    '#ef4444',
          orange: '#f59e0b',
        },
        surface: {
          50:  '#f8f9fc',
          100: '#1a1d2e',
          200: '#1e2235',
          300: '#232741',
          400: '#2a2f50',
          500: '#333866',
          600: '#3d4480',
          700: '#4a51a0',
          800: '#16192a',
          900: '#0f1120',
          950: '#080a14',
        },
      },
      fontFamily: {
        sans:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
        syne:    ['var(--font-syne)', 'sans-serif'],
        display: ['var(--font-syne)', 'sans-serif'],
        mono:    ['var(--font-jetbrains)', 'monospace'],
      },
      backgroundImage: {
        'gradient-brand':  'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
        'gradient-card':   'linear-gradient(135deg, rgba(79,70,229,0.1) 0%, rgba(124,58,237,0.05) 100%)',
        'gradient-hero':   'linear-gradient(135deg, #0f1120 0%, #1a1d2e 50%, #0f1120 100%)',
        'gradient-glow':   'radial-gradient(ellipse at top, rgba(79,70,229,0.15) 0%, transparent 70%)',
        'gradient-success':'linear-gradient(135deg, #059669 0%, #10b981 100%)',
        'gradient-danger': 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
        'gradient-futuristic': 'linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)',
        'gradient-neon': 'linear-gradient(135deg, #f43f5e 0%, #7c3aed 50%, #06b6d4 100%)',
        'gradient-dark-glass': 'linear-gradient(135deg, rgba(15, 23, 42, 0.45) 0%, rgba(30, 41, 59, 0.25) 100%)',
      },
      boxShadow: {
        'glow-brand': '0 0 30px rgba(99,102,241,0.3)',
        'glow-green': '0 0 20px rgba(16,185,129,0.2)',
        'glow-red':   '0 0 20px rgba(239,68,68,0.2)',
        'glow-cyan':  '0 0 25px rgba(6, 182, 212, 0.35)',
        'glow-violet':'0 0 25px rgba(124, 58, 237, 0.35)',
        'glow-rose':  '0 0 25px rgba(244, 63, 94, 0.35)',
        'card':       '0 8px 32px 0 rgba(0, 0, 0, 0.4)',
        'card-hover': '0 12px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(99,102,241,0.25)',
        'glass':      '0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
        'topbar':     '0 1px 0 rgba(255,255,255,0.05)',
      },
      animation: {
        'fade-in':       'fadeIn 0.4s ease-out',
        'slide-up':      'slideUp 0.35s ease-out',
        'pulse-slow':    'pulse 3s infinite',
        'spin-slow':     'spin 3s linear infinite',
        'glow-pulse':    'glowPulse 3s ease-in-out infinite',
        'float':         'float 6s ease-in-out infinite',
        'shimmer':       'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(99,102,241,0.2)' },
          '50%':      { boxShadow: '0 0 40px rgba(99,102,241,0.5)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      borderRadius: {
        'xl2': '1rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}

export default config
