import path from 'node:path';
import { fileURLToPath } from 'node:url';
import typography from '@tailwindcss/typography';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.js'),
  ],
  theme: {
    extend: {
      colors: {
        pd: {
          primary: '#1b4332',
          'primary-hover': '#15502a',
        },
      },
    },
  },
  plugins: [typography],
};
