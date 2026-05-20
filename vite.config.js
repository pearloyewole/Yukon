import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devBackendUrl = String(env.VITE_DEV_BACKEND_URL || 'http://localhost:8787').trim();

  return {
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: devBackendUrl,
          changeOrigin: true,
        },
      },
    },
    appType: 'mpa',
    build: {
      rollupOptions: {
        input: {
          home: path.resolve(__dirname, 'index.html'),
          logAnalysis: path.resolve(__dirname, 'log-analysis.html'),
          loggedAnalyses: path.resolve(__dirname, 'logged-analyses.html'),
        },
      },
    },
  };
});
