import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // allow the sandboxed preview proxy host
    allowedHosts: true,
    // forward backend routes to the one-process server (npm run serve) so
    // `npm run dev` is full-stack: run it with PORT=5174 (see .env / README)
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:5174', changeOrigin: true },
      '/mock': { target: process.env.API_PROXY_TARGET || 'http://localhost:5174', changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('pdfjs-dist')) return 'pdf';
          if (id.includes('mammoth')) return 'docx';
          if (id.includes('@codemirror') || id.includes('@uiw')) return 'editor';
          if (id.includes('highlight.js')) return 'md';
          return undefined;
        },
      },
    },
  },
});
