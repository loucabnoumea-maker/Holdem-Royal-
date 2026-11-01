/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `vite build --mode single` produit un unique fichier HTML autonome (partage facile).
export default defineConfig(({ mode }) => ({
  // Chemins relatifs : le site marche dans n'importe quel sous-dossier (GitHub Pages, Netlify…)
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  test: { testTimeout: 30_000 },
}))
