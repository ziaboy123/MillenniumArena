import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives under /millennium (like the other sites behind nginx). In development, API and WebSocket
// requests go to the server on :3017; in production the server serves this build itself.
const SERVER = process.env.ARENA_SERVER ?? 'http://localhost:3017';

export default defineConfig({
  base: '/millennium/',
  plugins: [react()],
  server: {
    port: 5185,
    strictPort: true,
    // the object form keeps the browser's Host header (the shorthand rewrites it), which the server's same-site check compares with Origin
    proxy: {
      '/millennium/api': { target: SERVER },
      '/millennium/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
});
