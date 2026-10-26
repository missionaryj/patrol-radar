import { defineConfig } from 'vite';
// GITHUB_PAGES=true → served from https://<user>.github.io/patrol-radar/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/patrol-radar/' : '/',
  build: { rollupOptions: { input: { main: 'index.html', v2: 'v2/index.html' } } },
  server: { host: true, allowedHosts: ['.trycloudflare.com', '.loca.lt'] },
});
