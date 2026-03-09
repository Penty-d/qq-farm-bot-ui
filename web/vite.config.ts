import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import viteCompression from 'vite-plugin-compression'

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    UnoCSS() as any,
    viteCompression({
      verbose: true,
      disable: false,
      threshold: 10240,
      algorithm: 'gzip',
      ext: '.gz',
    }),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vue') || id.includes('pinia') || id.includes('vue-router') || id.includes('@vueuse')) {
              return 'vendor-vue'
            }
            if (id.includes('axios')) {
              return 'vendor-axios'
            }
            // Split other large dependencies if needed
            if (id.includes('echarts') || id.includes('zrender')) {
              return 'vendor-echarts'
            }
            // Default vendor chunk
            return 'vendor'
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/game-config': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
