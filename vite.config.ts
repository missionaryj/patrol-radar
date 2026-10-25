import { defineConfig } from 'vite';
// GITHUB_PAGES=true → served from https://<user>.github.io/patrol-radar/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/patrol-radar/' : '/',
  server: { host: true, allowedHosts: ['.trycloudflare.com', '.loca.lt'] },
});
