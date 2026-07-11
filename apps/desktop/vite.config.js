import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rendererRoot = resolve(__dirname, 'renderer');

export default defineConfig({
  base: './',
  root: rendererRoot,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: ['chrome130'],
    minify: 'esbuild',
    rollupOptions: {
      input: resolve(rendererRoot, 'index.html'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
});
