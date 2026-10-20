import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// the commit this build came from, so the site can link to its exact source (AGPL-3.0 section 13)
let commit = '';
try { commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}

// The app lives under /millenniumarena (like the other sites behind nginx). In development, API and WebSocket
// requests go to the server on :3017; in production the server serves this build itself.
const SERVER = process.env.ARENA_SERVER ?? 'http://localhost:3017';

export default defineConfig({
  base: '/millenniumarena/',
  plugins: [react()],
  define: { __COMMIT__: JSON.stringify(commit) },
  server: {
    port: 5185,
    strictPort: true,
    // the object form keeps the browser's Host header (the shorthand rewrites it), which the server's same-site check compares with Origin
    proxy: {
      '/millenniumarena/api': { target: SERVER },
      '/millenniumarena/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      '/millenniumarena/img': { target: SERVER },
    },
  },
});
