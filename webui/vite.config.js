import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on every local interface during development so a phone or tablet
    // on the same LAN can load the touch UI using this machine's network IP.
    host: true,
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
    sourcemap: true,
  },
})
