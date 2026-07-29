import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so Capacitor/Android WebView loads the built bundle correctly.
  base: "./",
  plugins: [react()],
})
