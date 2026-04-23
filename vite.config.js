import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRunnerScript = path.resolve(__dirname, 'scripts', 'run_upload_pipeline.py');

function isFileLike(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.arrayBuffer === 'function' && typeof value.name === 'string';
}

function sanitizeUploadName(name) {
  const text = String(name || '').trim();
  const cleaned = text
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, '_')
    || `upload_${randomUUID()}`;
  return cleaned || `upload_${randomUUID()}`;
}

async function writeFormFile(file, destinationPath) {
  if (typeof file.stream === 'function') {
    const stream = file.stream();
    await pipeline(Readable.fromWeb(stream), createWriteStream(destinationPath));
    return;
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(destinationPath, bytes);
}

async function saveUploadedFiles(files, destinationDir, prefix) {
  await fs.mkdir(destinationDir, { recursive: true });
  const saved = [];
  const usedNames = new Set();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const baseName = sanitizeUploadName(file.name || `${prefix}_${i}`);
    const ext = path.extname(baseName);
    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
    let outName = baseName;
    if (usedNames.has(outName.toLowerCase())) {
      outName = `${stem}_${String(i + 1).padStart(3, '0')}${ext}`;
    }
    usedNames.add(outName.toLowerCase());
    const outPath = path.join(destinationDir, outName);
    await writeFormFile(file, outPath);
    saved.push(outPath);
  }
  return saved;
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        code: -1,
        stdout,
        stderr,
        error,
      });
    });

    child.on('close', (code) => {
      resolve({
        code: Number.isFinite(code) ? code : -1,
        stdout,
        stderr,
        error: null,
      });
    });
  });
}

async function runUploadPipeline({ manifestPath, riverId, outPath }) {
  const args = [
    uploadRunnerScript,
    '--manifest',
    manifestPath,
    '--river-id',
    riverId,
    '--out',
    outPath,
  ];

  const attempts = ['python3', 'python'];
  let lastResult = null;
  for (const executable of attempts) {
    const result = await runCommand(executable, args, __dirname);
    if (result.error && result.error.code === 'ENOENT') {
      continue;
    }
    if (result.code === 0) {
      return result;
    }
    lastResult = result;

    const combinedOutput = `${result.stderr || ''}\n${result.stdout || ''}`;
    if (/ModuleNotFoundError|No module named/i.test(combinedOutput)) {
      continue;
    }
    return result;
  }

  if (lastResult) {
    return lastResult;
  }

  return {
    code: -1,
    stdout: '',
    stderr: 'Python executable not found. Install python3 and ensure it is available in PATH.',
    error: new Error('python executable not found'),
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function normalizeRiverId(input) {
  const text = String(input || '').trim();
  const cleaned = text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || `river-${Date.now()}`;
}

function uploadPipelineApiPlugin() {
  const handleRequest = async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    const reqUrl = new URL(req.url || '/', 'http://localhost');
    if (reqUrl.pathname !== '/api/compile-river-package') {
      next();
      return;
    }

    let tempRoot = null;
    try {
      const webRequest = new Request(reqUrl.toString(), {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: 'half',
      });
      const form = await webRequest.formData();

      const riverId = normalizeRiverId(form.get('riverId'));
      const overviewFile = form.get('overviewFile');
      const matFiles = form.getAll('matFiles').filter(isFileLike);
      const shpFiles = form.getAll('shpFiles').filter(isFileLike);
      const sonarFiles = form.getAll('sonarFiles').filter(isFileLike);
      const tifFiles = form.getAll('tifFiles').filter(isFileLike);

      if (!isFileLike(overviewFile)) {
        sendJson(res, 400, { error: 'overviewFile is required.' });
        return;
      }
      if (matFiles.length === 0) {
        sendJson(res, 400, { error: 'At least one MATLAB upload is required.' });
        return;
      }
      if (shpFiles.length === 0) {
        sendJson(res, 400, { error: 'Shapefile upload is required.' });
        return;
      }

      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yukon-upload-'));
      const incomingDir = path.join(tempRoot, 'incoming');
      const overviewDir = path.join(incomingDir, 'overview');
      const matDir = path.join(incomingDir, 'mat');
      const shapeDir = path.join(incomingDir, 'shape');
      const sonarDir = path.join(incomingDir, 'sonar');
      const elevationDir = path.join(incomingDir, 'elevation');

      const overviewSaved = await saveUploadedFiles([overviewFile], overviewDir, 'overview');
      const matSaved = await saveUploadedFiles(matFiles, matDir, 'mat');
      const shpSaved = await saveUploadedFiles(shpFiles, shapeDir, 'shape');
      const sonarSaved = await saveUploadedFiles(sonarFiles, sonarDir, 'sonar');
      const tifSaved = await saveUploadedFiles(tifFiles, elevationDir, 'elevation');

      const manifest = {
        overview_file: overviewSaved[0],
        mat_files: matSaved,
        shp_files: shpSaved,
        sonar_files: sonarSaved,
        tif_files: tifSaved,
      };
      const manifestPath = path.join(tempRoot, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

      const outPath = path.join(tempRoot, 'compiled-package.json');
      const pipelineResult = await runUploadPipeline({
        manifestPath,
        riverId,
        outPath,
      });

      if (pipelineResult.code !== 0) {
        const details = (pipelineResult.stderr || pipelineResult.stdout || 'Upload pipeline failed.').trim();
        sendJson(res, 500, { error: details });
        return;
      }

      const packageText = await fs.readFile(outPath, 'utf-8');
      const packageData = JSON.parse(packageText);
      const sonarWarning = sonarSaved.length > 0 && !packageData?.sonar_bottom
        ? 'No usable sonar bottom points were found in the uploaded sonar data.'
        : '';
      const elevationWarning = tifSaved.length > 0 && !packageData?.elevation_raster
        ? 'No usable elevation surface was found in the uploaded TIFF data.'
        : '';

      sendJson(res, 200, {
        packageData,
        sonarWarning,
        elevationWarning,
      });
    } catch (error) {
      const message = error?.message || String(error);
      sendJson(res, 500, { error: message });
    } finally {
      if (tempRoot) {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    }
  };

  return {
    name: 'upload-pipeline-api',
    configureServer(server) {
      server.middlewares.use(handleRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleRequest);
    },
  };
}

export default defineConfig({
  plugins: [uploadPipelineApiPlugin()],
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173, // Default Vite port
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
});
