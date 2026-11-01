/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { canvas: 'var(--color-canvas)', surface: 'var(--color-surface)', graphite: 'var(--color-graphite)', evergreen: 'var(--color-evergreen)', muted: 'var(--color-muted)', line: 'var(--color-line)' },
    fontFamily: { sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'] },
  } },
  plugins: [],
};
