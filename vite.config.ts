import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    // `@/` is the React app's folder, as in shadcn's Vite setup (tsconfig.app.json has the same path).
    alias: { '@': fileURLToPath(new URL('./src/react-app', import.meta.url)) },
  },
  build: {
    // The admin panel is the page at admin/index.html, so it is served at /admin/ ...
    rollupOptions: { input: 'admin/index.html' },
    // ... and its script and stylesheet are built into /admin/assets/, behind the same Access path.
    assetsDir: 'admin/assets',
  },
});
