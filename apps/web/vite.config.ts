import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // En developpement, l'interface parle au serveur local sans configuration.
    proxy: {
      '/api': { target: 'http://127.0.0.1:7777', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Aucune reference a une ressource distante dans le bundle: l'application
    // doit fonctionner sans connexion.
    assetsInlineLimit: 4096,
  },
});
