import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** GitHub Project Page URL: https://<user>.github.io/<repo>/ — assets must load under /REPO/. */
const REPO_BASE = '/Markdown2PDF-Editor/';

export default defineConfig({
  base: REPO_BASE,
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
