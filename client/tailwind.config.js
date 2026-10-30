/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#1a1a2e',
        'navy-light': '#16213e',
        accent: '#4361ee',
        'accent-hover': '#3a56d4',
        confirmed: '#22c55e',
        uncertain: '#f59e0b',
        missing: '#ef4444',
      },
    },
  },
  plugins: [],
};
