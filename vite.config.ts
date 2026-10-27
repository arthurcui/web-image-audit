// Configure the React dev server, loopback binding, and API proxy.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const proxy = { '/api': 'http://127.0.0.1:3001' };

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: '../../dist/web',
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy,
    strictPort: true,
  },
});
