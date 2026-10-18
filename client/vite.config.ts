import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives under /millenniumarena (like the other sites behind nginx). In development, API and WebSocket
// requests go to the server on :3017; in production the server serves this build itself.
const SERVER = process.env.ARENA_SERVER ?? 'http://localhost:3017';

export default defineConfig({
  base: '/millenniumarena/',
  plugins: [react()],
  server: {
    port: 5185,
    strictPort: true,
    // the object form keeps the browser's Host header (the shorthand rewrites it), which the server's same-site check compares with Origin
    proxy: {
      '/millenniumarena/api': { target: SERVER },
      '/millenniumarena/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
});
