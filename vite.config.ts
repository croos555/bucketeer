import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer only: the backend is the Rust crate in src-tauri, which also sets the CSP (tauri.conf.json)
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  clearScreen: false,
  server: { port: 5175, strictPort: true },
  build: { outDir: resolve('out/renderer'), emptyOutDir: true, target: 'es2022' }
})
