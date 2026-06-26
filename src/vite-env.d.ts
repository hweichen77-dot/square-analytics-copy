/// <reference types="vite/client" />

declare module '@capacitor/app' {
  export const App: {
    addListener(
      event: 'appUrlOpen',
      handler: (data: { url: string }) => void
    ): Promise<{ remove: () => void }>
  }
}

declare module '@capacitor/browser' {
  export const Browser: {
    open(options: { url: string }): Promise<void>
    close(): Promise<void>
  }
}

declare module '@tauri-apps/plugin-deep-link' {
  export function onOpenUrl(handler: (urls: string[]) => void): Promise<() => void>
}

declare module '@tauri-apps/plugin-opener' {
  export function openUrl(url: string): Promise<void>
}
