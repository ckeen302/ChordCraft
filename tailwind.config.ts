import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          deep:   '#0c0e14',
          panel:  '#13161f',
          raised: '#1a1e2c',
          card:   '#1e2436',
        },
        accent: {
          DEFAULT: '#00e5a0',
          hover:   '#00ffb3',
          dim:     '#007a56',
          muted:   'rgba(0,229,160,0.12)',
        },
        border: {
          DEFAULT: '#252b3a',
          bright:  '#3a4255',
        },
        text: {
          DEFAULT: '#e2e6f0',
          muted:   '#7b8494',
          dim:     '#4a5060',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'chord-active': '0 0 0 2px #00e5a0, 0 0 24px 6px rgba(0,229,160,0.35)',
        'glow-sm': '0 0 12px 2px rgba(0,229,160,0.25)',
      },
      animation: {
        'pulse-glow': 'pulseGlow 1.4s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 2px #00e5a0, 0 0 14px 3px rgba(0,229,160,0.30)' },
          '50%':      { boxShadow: '0 0 0 2px #00ffb3, 0 0 30px 8px rgba(0,229,160,0.55)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
