import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, Vite sirve el cliente y redirige /ws al servidor de salas (puerto 8080)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': 'http://localhost:8080',
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
