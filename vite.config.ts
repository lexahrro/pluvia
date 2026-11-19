import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Chemins relatifs : l'app fonctionne aussi bien à la racine d'un domaine
  // que dans un sous-dossier (ex. GitHub Pages : utilisateur.github.io/pluvia/).
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pluvia',
        short_name: 'Pluvia',
        description: 'Va-t-il pleuvoir ? Prévisions de pluie et radar.',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0b1d33',
        theme_color: '#0b1d33',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // L'application elle-même (HTML, JS, CSS, icônes) est mise en cache pour fonctionner hors ligne.
        // Les données météo ne passent pas par le service worker : l'app garde elle-même la dernière réponse.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Gestion des notifications push (alertes de pluie), dans public/push-sw.js.
        importScripts: ['push-sw.js'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
