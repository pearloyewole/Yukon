import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parsePortFromUrl(urlString, fallback = 3000) {
  try {
    const port = Number(new URL(urlString).port);
    return Number.isFinite(port) && port > 0 ? port : fallback;
  } catch {
    return fallback;
  }
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForPort(port, host = '127.0.0.1', timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Aligner server not reachable at http://${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function spawnAligner(port) {
  const scriptPath = path.join(projectRoot, 'aligner-server', 'aligner.py');
  const env = { ...process.env, PORT: String(port) };
  const executables = ['python3', 'python'];

  return new Promise((resolve) => {
    let index = 0;

    const tryNext = () => {
      if (index >= executables.length) {
        resolve(null);
        return;
      }

      const executable = executables[index];
      index += 1;

      const child = spawn(executable, [scriptPath], {
        cwd: projectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (chunk) => {
        process.stdout.write(`[aligner] ${chunk}`);
      });
      child.stderr?.on('data', (chunk) => {
        process.stderr.write(`[aligner] ${chunk}`);
      });

      child.once('error', () => {
        tryNext();
      });

      child.once('spawn', () => {
        resolve({ child, executable });
      });
    };

    tryNext();
  });
}

/**
 * Starts aligner-server/aligner.py when Vite dev server boots; stops it on shutdown.
 */
export function yukonAlignerDevPlugin(alignerUrl = 'http://127.0.0.1:3000') {
  const port = parsePortFromUrl(alignerUrl, 3000);
  let alignerProcess = null;
  let spawnedByPlugin = false;

  const stopAligner = () => {
    if (!alignerProcess || !spawnedByPlugin) return;
    alignerProcess.kill('SIGTERM');
    alignerProcess = null;
    spawnedByPlugin = false;
  };

  return {
    name: 'yukon-aligner-dev',
    apply: 'serve',
    async configureServer(server) {
      if (alignerProcess) return;

      const portBusy = await isPortOpen(port);
      if (portBusy) {
        console.log(
          `[aligner] Reusing existing server on http://127.0.0.1:${port} (proxied via /aligner-api)`,
        );
        console.log(
          '[aligner] To restart the aligner, stop other dev sessions or: lsof -i :3000',
        );
        return;
      }

      const spawned = await spawnAligner(port);
      if (!spawned) {
        console.warn(
          '[aligner] Could not start Python. Install deps: npm run aligner:install',
        );
        return;
      }

      alignerProcess = spawned.child;
      spawnedByPlugin = true;
      alignerProcess.on('exit', (code, signal) => {
        if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
          console.warn(`[aligner] Process exited (code=${code}, signal=${signal})`);
        }
        alignerProcess = null;
      });

      try {
        await waitForPort(port);
        console.log(`[aligner] Ready at http://127.0.0.1:${port} (proxied via /aligner-api)`);
      } catch (error) {
        console.warn(`[aligner] ${error.message}`);
        console.warn('[aligner] River aligner API calls may fail until Python starts.');
      }

      // configureServer's return value is a post hook (runs after middleware install),
      // not teardown — register shutdown on the HTTP server instead.
      server.httpServer?.once('close', stopAligner);
      process.once('exit', stopAligner);
    },
  };
}
