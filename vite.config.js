import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": a new version waits until the person taps Reload, so an open form is never
      // swapped to new code (and a new database contract) in the middle of use.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Family Wallet',
        short_name: 'Wallet',
        description: 'Private family expense & wallet tracker',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // App shell + the self-hosted font only. Data requests to Supabase are never cached.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/inter-cyrillic*', '**/inter-greek*', '**/inter-vietnamese*'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true
      }
    })
  ],
  server: {
    port: 5173
  }
})
