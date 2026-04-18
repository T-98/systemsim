import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { generateAllTopics } from './scripts/generate-reference-topics';
import { resolve } from 'node:path';

/**
 * Vite plugin that regenerates the auto-imported reference topics from
 * `system-design-knowledgebase.md`. Runs on dev-server boot and on every
 * build, plus re-runs when the KB file changes during dev.
 */
function referenceTopicsPlugin(): Plugin {
  const kbPath = resolve(__dirname, 'system-design-knowledgebase.md');
  const learnDir = resolve(__dirname, 'src/wiki/content/learn');
  const howtoDir = resolve(__dirname, 'src/wiki/content/howto');
  return {
    name: 'systemsim-reference-topics',
    buildStart() {
      try {
        generateAllTopics();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[systemsim-reference-topics] buildStart failed:', err);
      }
    },
    configureServer(server) {
      server.watcher.add(kbPath);
      server.watcher.add(learnDir);
      server.watcher.add(howtoDir);
      server.watcher.on('change', (file) => {
        if (file === kbPath || file.startsWith(learnDir) || file.startsWith(howtoDir)) {
          try {
            generateAllTopics();
            server.ws.send({ type: 'full-reload' });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[systemsim-reference-topics] regenerate failed:', err);
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [referenceTopicsPlugin(), react(), tailwindcss()],
  server: {
    port: 5180,
  },
  test: {
    globals: true,
    exclude: ['e2e/**', 'evals/**', 'node_modules/**'],
  },
});
