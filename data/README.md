# Timelapse demo data (in-repo)

Curated folders under `timelapse/` are the **only** image sequences tracked in git:

| Folder | Images | Use |
|--------|--------|-----|
| `timelapse/alakanuk_site_a` | 7 | Small Alakanuk demo |
| `timelapse/alakanuk_site_b` | 8 | Small Alakanuk demo |
| `timelapse/sequence_60` | 60 | Medium demo sequence |

Large folders from the original workspace dataset (400+ frames, 16-frame sets, etc.) are **not** included. See `manifest.json`.

## Refresh from a full local dataset

If you still have the old workspace `Yukon/data` tree on disk:

```bash
npm run data:sync
```

Override source path:

```bash
YUKON_SOURCE_DATA=/path/to/full/data npm run data:sync
```

## App configuration

Vite defaults `VITE_DATA_ROOT` to `<repo>/data/timelapse`. Cross-section mappings live in `public/timelapse-sources.json`.
