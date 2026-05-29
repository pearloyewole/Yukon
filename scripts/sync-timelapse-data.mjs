#!/usr/bin/env node
/**
 * Copies curated timelapse folders (7–8 and 60 images only) into data/timelapse/.
 * Source defaults to workspace Yukon/data (../../data from this repo).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const defaultSourceRoot = path.resolve(projectRoot, '..', 'data');
const targetRoot = path.join(projectRoot, 'data', 'timelapse');

const SOURCES = [
  {
    id: 'alakanuk_site_a',
    from: 'Example_timelapse_data/Alakanuk_BeringSea_2023_A/20230614',
    expectImages: 7,
  },
  {
    id: 'alakanuk_site_b',
    from: 'Example_timelapse_data/Alakanuk_BeringSea_2023_B/20230614',
    expectImages: 8,
  },
  {
    id: 'sequence_60',
    from: 'sub_data1',
    expectImages: 60,
  },
];

const IMAGE_RE = /\.(jpe?g|png)$/i;

function countImages(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && IMAGE_RE.test(entry.name)) count += 1;
  }
  return count;
}

function copyDir(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

const sourceRoot = String(process.env.YUKON_SOURCE_DATA || defaultSourceRoot).trim();

console.log(`[data:sync] Source: ${sourceRoot}`);
console.log(`[data:sync] Target: ${targetRoot}`);

if (!existsSync(sourceRoot)) {
  console.error('[data:sync] Source data folder not found. Set YUKON_SOURCE_DATA or place data at ../data');
  process.exit(1);
}

mkdirSync(targetRoot, { recursive: true });

let failed = false;
for (const item of SOURCES) {
  const src = path.join(sourceRoot, item.from);
  const dest = path.join(targetRoot, item.id);
  if (!existsSync(src)) {
    console.error(`[data:sync] Missing source: ${src}`);
    failed = true;
    continue;
  }
  const n = countImages(src);
  if (n !== item.expectImages) {
    console.warn(`[data:sync] ${item.id}: expected ${item.expectImages} images, found ${n} (copying anyway)`);
  }
  console.log(`[data:sync] Copying ${item.id} (${n} images)...`);
  copyDir(src, dest);
}

if (failed) {
  process.exit(1);
}

console.log('[data:sync] Done. Curated folders are ready under data/timelapse/.');
