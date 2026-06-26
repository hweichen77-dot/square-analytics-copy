import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.walleys.analytics',
  appName: "Walley's Analytics",
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
