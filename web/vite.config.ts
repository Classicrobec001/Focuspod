import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves project sites from /<repo>/, so the CI workflow sets
// VITE_BASE=/Focuspod/. Local dev and root-domain hosts use '/'.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      // Consume core straight from source — one TypeScript project, no build
      // step between the shared layer and the app.
      '@focuspod/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true, // reachable from a phone on the same network for real-device testing
    port: 5173,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'FocusPod',
        short_name: 'FocusPod',
        description:
          'Distraction-free public-domain audiobooks with an iPod click wheel and focus sessions.',
        theme_color: '#2A2A2A',
        background_color: '#E8E8E3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        categories: ['books', 'productivity', 'music'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Audio is deliberately excluded from Workbox: chapter files are tens of
        // megabytes and are managed explicitly by the download port, which owns
        // its own cache. Letting Workbox also cache them would double the disk
        // cost and interfere with the range requests the audio element issues
        // while seeking.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/archive\.org\/(advancedsearch\.php|metadata)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'focuspod-catalog',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Book texts for read-along. Cached on first read so returning to
            // a book works offline; a few hundred KB each, hence the low cap.
            urlPattern: /^https:\/\/archive\.org\/download\/.*\.txt$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'focuspod-texts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/archive\.org\/services\/img\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'focuspod-covers',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // a live SW during dev makes HMR confusing
      },
    }),
  ],
});
