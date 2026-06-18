import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'

const ANALYTICS_PLACEHOLDER = '<!-- analytics:inject -->'

function analyticsTags() {
  return {
    name: 'analytics-tags',
    transformIndexHtml(html) {
      const tagsPath = new URL('./src/config/analytics.html', import.meta.url)
      const tags = fs.existsSync(tagsPath) ? fs.readFileSync(tagsPath, 'utf8').trim() : ''
      return html.replace(ANALYTICS_PLACEHOLDER, tags)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), analyticsTags()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
})
