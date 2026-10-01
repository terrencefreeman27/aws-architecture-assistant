import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.API_PORT ?? 4080);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5180);

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: { '/api': `http://localhost:${API_PORT}` },
  },
  preview: {
    port: WEB_PORT,
    strictPort: true,
    proxy: { '/api': `http://localhost:${API_PORT}` },
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
