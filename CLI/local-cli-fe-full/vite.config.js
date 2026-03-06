import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build'
  },
  commonjsOptions: {
    transformMixedEsModules: true
  },
  server: {
    port: 31800
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
    exclude: []
  },
  optimizeDeps: {
    include: [
      'dexie-encrypted',
      'jspdf',
      'jspdf-autotable',
      'xterm',
      'xterm-addon-fit'
    ],
    esbuildOptions: {
      loader: {
        '.js': 'jsx'
      }
    }
  }
})
