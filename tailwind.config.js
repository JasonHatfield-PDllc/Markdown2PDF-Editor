import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,html}'],
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
