import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const apiKey = env.VITE_HYDROMANCER_API_KEY ?? ''

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/hydromancer': {
          target: 'https://api.hydromancer.xyz',
          changeOrigin: true,
          // Strip /api/hydromancer prefix so the request lands on /info
          rewrite: () => '/info',
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq) => {
              // Inject the API key server-side — keeps it out of the client bundle
              proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
            })
          },
        },
      },
    },
  }
})
