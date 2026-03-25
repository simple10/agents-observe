import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    strictPort: false,
    host: '0.0.0.0',
    watch: {
      usePolling: true,
    },
  }
})
