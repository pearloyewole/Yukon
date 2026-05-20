import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uploadRunnerScript = path.resolve(projectRoot, 'scripts', 'run_upload_pipeline.py');
const uploadStagingDir = path.join(os.tmpdir(), 'yukon-upload-staging');

const PORT = Number(process.env.PORT || 8787);
const MAX_UPLOAD_FILES = Number(process.env.MAX_UPLOAD_FILES || 240);
const MAX_UPLOAD_FILE_MB = Number(process.env.MAX_UPLOAD_FILE_MB || 700);

await fs.mkdir(uploadStagingDir, { recursive: true });

const upload = multer({
  dest: uploadStagingDir,
  limits: {
    files: MAX_UPLOAD_FILES,
    fileSize: Math.max(1, MAX_UPLOAD_FILE_MB) * 1024 * 1024,
  },
});

const app = express();
app.use(buildCorsMiddleware());

app.get('/api/health', (_req, res) => {
  sendJson(res, 200, { ok: true });
});

app.post('/api/compile-river-package', upload.any(), async (req, res) => {
  let tempRoot = null;
  const stagedPaths = Array.isArray(req.files) ? req.files.map((file) => file.path).filter(Boolean) : [];

  try {
    const riverId = normalizeRiverId(req.body?.riverId);
    const overviewFile = findSingleUploadedFile(req, 'overviewFile');
    const matFiles = findUploadedFiles(req, 'matFiles');
    const shpFiles = findUploadedFiles(req, 'shpFiles');
    const sonarFiles = findUploadedFiles(req, 'sonarFiles');
    const tifFiles = findUploadedFiles(req, 'tifFiles');

    if (!overviewFile) {
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
    sendJson(res, 500, { error: error?.message || String(error) });
  } finally {
    await Promise.all(stagedPaths.map((filePath) => fs.rm(filePath, { force: true })));
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    sendJson(res, 400, { error: error.message });
    return;
  }
  sendJson(res, 500, { error: error?.message || String(error) });
});

app.listen(PORT, () => {
  console.log(`Yukon backend listening on http://0.0.0.0:${PORT}`);
});

function findUploadedFiles(req, fieldName) {
  const files = Array.isArray(req.files) ? req.files : [];
  return files.filter((file) => file?.fieldname === fieldName);
}

function findSingleUploadedFile(req, fieldName) {
  return findUploadedFiles(req, fieldName)[0] || null;
}

function isMulterFile(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.path === 'string';
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

async function saveUploadedFiles(files, destinationDir, prefix) {
  await fs.mkdir(destinationDir, { recursive: true });

  const saved = [];
  const usedNames = new Set();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!isMulterFile(file)) continue;

    const baseName = sanitizeUploadName(file.originalname || `${prefix}_${i + 1}`);
    const ext = path.extname(baseName);
    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
    let outName = baseName;
    if (usedNames.has(outName.toLowerCase())) {
      outName = `${stem}_${String(i + 1).padStart(3, '0')}${ext}`;
    }
    usedNames.add(outName.toLowerCase());

    const outPath = path.join(destinationDir, outName);
    await fs.rename(file.path, outPath);
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
    const result = await runCommand(executable, args, projectRoot);
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

  if (lastResult) return lastResult;
  return {
    code: -1,
    stdout: '',
    stderr: 'Python executable not found. Install python3 and ensure it is available in PATH.',
    error: new Error('python executable not found'),
  };
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function normalizeRiverId(input) {
  const text = String(input || '').trim();
  const cleaned = text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || `river-${Date.now()}`;
}

function buildCorsMiddleware() {
  const allowListRaw = String(process.env.ALLOWED_ORIGINS || '').trim();
  if (!allowListRaw) return cors({ origin: true });

  const allowList = allowListRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return cors({
    origin(origin, callback) {
      if (!origin || allowList.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  });
}
