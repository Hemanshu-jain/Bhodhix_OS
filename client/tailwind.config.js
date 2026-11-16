/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bhodix: {
          bg: 'var(--bhodix-bg)',
          surface: 'var(--bhodix-surface)',
          card: 'var(--bhodix-card)',
          hover: 'var(--bhodix-hover)',
          border: 'var(--bhodix-border)',
          borderSubtle: 'var(--bhodix-border-subtle)',
          borderHover: 'var(--bhodix-border-hover)',
          accent: '#6366f1',
          accentHover: '#4f46e5',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          text: 'var(--bhodix-text)',
          textMuted: 'var(--bhodix-text-muted)',
          textSubtle: 'var(--bhodix-text-subtle)'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      }
    },
  },
  plugins: [],
}
