import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  server: {
    proxy: { '/api': 'http://localhost:3000' },
    // Allow any host in dev so the dashboard also loads behind preview proxies
    // (e2b/localhost/0.0.0.0). Production serving goes through the Express server.
    allowedHosts: true,
  },
});
