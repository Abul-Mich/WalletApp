import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Day 5 will tune this further, but registering it early means the
// service worker is already caching the app shell from Day 1 onward.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Family Wallet',
        short_name: 'Wallet',
        description: 'Private family expense & wallet tracker',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        // Cache the built JS/CSS/HTML app shell. Data requests to Supabase
        // are never cached here — only the app shell itself (NFR2/NFR3).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}']
      }
    })
  ],
  server: {
    port: 5173
  }
})
