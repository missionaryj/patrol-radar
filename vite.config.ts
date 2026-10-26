import { defineConfig } from 'vite';
// GITHUB_PAGES=true → served from https://<user>.github.io/patrol-radar/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
  base: process.env.GITHUB_PAGES ? '/patrol-radar/' : '/',
  build: { rollupOptions: { input: { main: 'index.html', v2: 'v2/index.html' } } },
  server: { host: true, allowedHosts: ['.trycloudflare.com', '.loca.lt'] },
});
