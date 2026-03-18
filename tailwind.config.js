/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Quote UI palette — true black base
        surface: {
          0: '#000000',
          1: '#0a0a0a',
          2: '#111111',
          3: '#161616',
          4: '#1c1c1c',
        },
        border: {
          DEFAULT: '#1f1f1f',
          subtle: '#141414',
          bright: '#2a2a2a',
        },
        text: {
          primary: '#ffffff',
          secondary: '#888888',
          muted: '#555555',
          dim: '#333333',
        },
        accent: {
          blue: '#3B82F6',
          'blue-dim': '#1D4ED8',
          cyan: '#06B6D4',
          purple: '#8B5CF6',
        },
        pos: {
          DEFAULT: '#22c55e',
          dim: '#052e16',
          bright: '#4ade80',
        },
        neg: {
          DEFAULT: '#ef4444',
          dim: '#1f0707',
          bright: '#f87171',
        },
        warn: {
          DEFAULT: '#f59e0b',
          dim: '#1f1000',
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
