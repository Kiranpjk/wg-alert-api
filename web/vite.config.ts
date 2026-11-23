import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE || '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, ''),
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/testSetup.ts'], maxWorkers: 4 },
}))
