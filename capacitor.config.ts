import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'nl.runcoach.app',
  appName: 'Run Coach',
  webDir: 'dist',
  plugins: {
    // Achtergrond audio: iOS mag audio afspelen achter lock screen
    CapacitorHttp: {
      enabled: false,
    },
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#000000',
    // Schakel audio-achtergrond modus in via Info.plist (zie ios/App/App/Info.plist)
    allowsLinkPreview: false,
  },
}

export default config
