import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Never inject a server credential into the browser bundle. The app obtains
    // user-provided keys from its own settings and sends them only per request.
    'process.env.GEMINI_API_KEY': JSON.stringify('')
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1_500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@google/genai')) return 'ai-provider';
          if (id.includes('three')) return 'three';
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'documents';
          if (id.includes('leaflet') || id.includes('d3-geo')) return 'maps';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    hmr: process.env.DISABLE_HMR !== 'true'
  }
});
