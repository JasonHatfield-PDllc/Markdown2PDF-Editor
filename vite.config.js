import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Relative base works for both:
 * - Project Pages: https://<user>.github.io/<repo>/ (assets resolve under /repo/)
 * - Custom domain: https://sub.example.com/ (assets resolve under /)
 * Absolute /repo/ breaks on custom-domain root; absolute / breaks github.io/repo/ unless you split builds.
 */
export default defineConfig({
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['chrome88', 'edge88'],
    minify: 'esbuild',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  publicDir: 'public',
});
