import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      // Mission progress arrives over Server-Sent Events, which must not be
      // buffered by the dev proxy or the island would only animate at the end.
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
