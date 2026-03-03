import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const isCapacitor = process.env.VITE_CAPACITOR === '1'

  return {
    // Capacitor laadt assets relatief; Vercel gebruikt absolute paden
    base: isCapacitor ? './' : '/',
    plugins: [
      react(),
      tailwindcss(),
      // PWA alleen voor web-build, niet voor Capacitor
      !isCapacitor && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'audio/*.mp3'],
        manifest: {
          name: 'Run Coach',
          short_name: 'RunCoach',
          description: 'Your personal running coach - audio-guided interval training',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,mp3,wav}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
              handler: 'NetworkFirst',
              options: { cacheName: 'supabase-cache', networkTimeoutSeconds: 10 },
            },
          ],
        },
      }),
    ].filter(Boolean),
  }
})
