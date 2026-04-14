import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
  },
  test: {
    globals: true,
    exclude: ['e2e/**', 'evals/**', 'node_modules/**'],
  },
});
