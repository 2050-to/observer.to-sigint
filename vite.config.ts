import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const caPath = new URL('./certs/ca.crt', import.meta.url)
const ca = existsSync(caPath) ? readFileSync(caPath) : undefined

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:9453',
        secure: true,
        changeOrigin: true,
        ...(ca ? { ca } : {}),
      },
    },
  },
})
