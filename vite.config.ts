import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/hydromancer': {
        target: 'https://api.hydromancer.xyz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/hydromancer/, ''),
      },
    },
  },
})
