import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isTauri = process.env.TAURI_ENV_TARGET_TRIPLE !== undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: isTauri ? './' : '/Walleys-Analytics/',

  server: {
    port: 5173,
    strictPort: true,
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts':  ['recharts'],
          'vendor-pdf':     ['jspdf', 'jspdf-autotable'],
          'vendor-db':      ['dexie', 'dexie-react-hooks'],
          'vendor-parsers': ['papaparse', 'xlsx'],
        },
      },
    },
  },
})
