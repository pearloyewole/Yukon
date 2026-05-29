import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { yukonAlignerDevPlugin } from './scripts/vite-aligner-dev-plugin.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devBackendUrl = String(env.VITE_DEV_BACKEND_URL || 'http://localhost:8787').trim();
  const devAlignerUrl = String(env.VITE_DEV_ALIGNER_URL || 'http://127.0.0.1:3000').trim();
  const defaultDataRoot = path.resolve(__dirname, 'data', 'timelapse');
  const dataRoot = String(env.VITE_DATA_ROOT || '').trim() || defaultDataRoot;

  return {
    define: {
      'import.meta.env.VITE_DATA_ROOT': JSON.stringify(dataRoot),
    },
    plugins: [yukonAlignerDevPlugin(devAlignerUrl)],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/aligner-api': {
          target: devAlignerUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/aligner-api/, '/api'),
        },
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
          riverAligner: path.resolve(__dirname, 'river-aligner.html'),
        },
      },
    },
  };
});
