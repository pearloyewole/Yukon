# Yukon

# preview link: https://yukon-ten.vercel.app/ 

**Note: Uploads and image alignment will not work on the online preview. If you would like to run this locally to access the image alignment features please follow the steps below:**

## Quick start

Requires **Node 18+**, **Python 3**, and **Git LFS** (timelapse demo images).

```bash
git clone <your-repo-url>
cd Yukon

git lfs install
git lfs pull

npm run setup
npm run dev
```

Open **http://localhost:5173**

| Command | What it does |
|---------|----------------|
| `npm run setup` | `npm install` + Python aligner dependencies (OpenCV, etc.) |
| `npm run dev` | Vite UI + auto-starts aligner API on port 3000 |
| `npm run data:sync` | Re-copy 7 / 8 / 60-frame folders from a full local `../data` tree |

## What’s in the repo

- **App** — Vite + Three.js (`index.html`, `log-analysis.html`, `river-aligner.html`)
- **River packages** — `public/river-packages/*.json` (preloaded demos)
- **Timelapse data** — `data/timelapse/` (only small sets: 7, 8, and 60 images)
- **Aligner API** — `aligner-server/aligner.py` (proxied at `/aligner-api` in dev)

Large image folders (400+ frames) are **not** tracked. See `data/manifest.json`.

## Features

1. **Home** — Load river analysis, logged analyses, or standalone aligner  
2. **3D viewer** — Cross-sections, velocity plots, sheet export  
3. **Timelapse** — HUD checkbox *Show timelapse cross-section markers* → purple beacons on sections 1–3 → **Generate timelapse** → modal aligner → preview video in sidebar  

Mappings: `public/timelapse-sources.json`  
Default image root: `data/timelapse` (override with `VITE_DATA_ROOT` in `.env` if needed).

## Optional

- `npm run dev:backend` — Node compile API (port 8787) for upload pipeline  
- `npm run build` — Production static build  
- `npm run dev:aligner` — Python aligner only (debug)

## Troubleshooting

- **Timelapse / preview fails** — Ensure `npm run dev` is running (aligner on port 3000). Only one dev server at a time.  
- **Missing images after clone** — Run `git lfs pull`.  
- **Refresh demo data** — `npm run data:sync` from workspace `Yukon/data` if you still have the full dataset locally.

