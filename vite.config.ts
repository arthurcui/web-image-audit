// Configure the React dev server, loopback binding, and API proxy.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = { '/api': 'http://127.0.0.1:3001' };

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
