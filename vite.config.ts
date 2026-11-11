import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH wird beim GitHub-Pages-Build auf "/<repo>/" gesetzt.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
  },
});
