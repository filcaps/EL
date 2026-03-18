/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#080B12',
          1: '#0D1117',
          2: '#121820',
          3: '#182030',
          4: '#1E2840',
        },
        border: {
          DEFAULT: '#1E2A3A',
          subtle: '#141E2E',
          bright: '#2A3A50',
        },
        text: {
          primary: '#E2EAF4',
          secondary: '#8CA0BE',
          muted: '#4A5A72',
          dim: '#2E3C52',
        },
        accent: {
          blue: '#3B82F6',
          'blue-dim': '#1D4ED8',
          cyan: '#06B6D4',
          purple: '#8B5CF6',
        },
        pos: {
          DEFAULT: '#10B981',
          dim: '#064E3B',
          bright: '#34D399',
        },
        neg: {
          DEFAULT: '#EF4444',
          dim: '#450A0A',
          bright: '#F87171',
        },
        warn: {
          DEFAULT: '#F59E0B',
          dim: '#451A03',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
