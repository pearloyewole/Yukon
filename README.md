# Yukon River 3D Viewer (Preloaded Rivers)

This project is currently configured with **three preloaded river packages**:
- Huslia
- Alakanuk
- Beaver

Each package renders in the 3D viewer with cross-section plots and supporting metadata.

## River data layout

River source data is organized under:

- `/Users/pearloyewole/yukon/data/rivers/huslia`
- `/Users/pearloyewole/yukon/data/rivers/alakanuk`
- `/Users/pearloyewole/yukon/data/rivers/beaver`

Prebuilt viewer packages are in:

- `/Users/pearloyewole/yukon/public/river-packages/huslia.json`
- `/Users/pearloyewole/yukon/public/river-packages/alakanuk.json`
- `/Users/pearloyewole/yukon/public/river-packages/beaver.json`

Elevation sidecars are in:

- `/Users/pearloyewole/yukon/public/river-packages/huslia.elevation.json`
- `/Users/pearloyewole/yukon/public/river-packages/alakanuk.elevation.json`
- `/Users/pearloyewole/yukon/public/river-packages/beaver.elevation.json`

## Terrain toggles

In the viewer HUD:
- `Vegetation terrain (GEF)` toggles terrain source (`GEG` default, `GEF` when available)
- `Earth terrain colors` toggles color palette (blue palette remains default)

## Quick start

```bash
cd /Users/pearloyewole/yukon
npm install
npm run dev
```

Then open the printed local URL and use the preloaded river spots from the HUD or Logged Analyses page.

## Deploy to Vercel (No Backend)

This repo can be deployed to Vercel as a static site with no backend services.

Included config:
- `[/Users/pearloyewole/yukon/vercel.json](/Users/pearloyewole/yukon/vercel.json)` (builds Vite and serves `dist`)

Recommended environment for Vercel:
- `VITE_ENABLE_UPLOAD_PIPELINE=false`
- `VITE_API_BASE_URL=` (empty)

Behavior in this mode:
- Preloaded rivers (Huslia, Alakanuk, Beaver) are fully viewable.
- Upload-and-compile flow is disabled (it requires a backend).

## Zip pipeline for future rivers

You can process a river upload bundle directly:

```bash
python /Users/pearloyewole/yukon/scripts/build_river_package.py \
  --river-id my-river \
  --input-zip /path/to/my-river-upload.zip \
  --out /Users/pearloyewole/yukon/public/river-packages/my-river.json
```

Expected zip contents:
- one shapefile set (`.shp`, `.dbf`, `.shx`)
- one overview `.xlsx`
- one or more `.mat` files (any folder depth)
- optional sonar bottom `.csv` files (any folder depth)
- optional elevation GeoTIFF (`.tif`/`.tiff`)

Then load that JSON from the file picker in the app, or set it as default in `/Users/pearloyewole/yukon/src/main.js`.

## Sonar bottom data (optional, reusable)

You can add sonar bottom data from a separate zip later (without changing your MAT workflow):

```bash
python /Users/pearloyewole/yukon/scripts/build_river_package.py \
  --river-id my-river \
  --shp /path/to/MyRiver.shp \
  --overview /path/to/MyRiver_overview.xlsx \
  --mat-glob "/path/to/mat/*.mat" \
  --sonar-zip /path/to/MyRiver_sonar.zip \
  --out /Users/pearloyewole/yukon/public/river-packages/my-river.json
```

Sonar CSV columns are auto-detected when they include latitude/longitude/depth fields. The output package includes a `sonar_bottom` section with sampled bottom points and depth stats.

## Elevation GeoTIFF (optional)

You can add terrain context around the river from one or more GeoTIFF rasters:

```bash
python /Users/pearloyewole/yukon/scripts/build_river_package.py \
  --river-id my-river \
  --shp /path/to/MyRiver.shp \
  --overview /path/to/MyRiver_overview.xlsx \
  --mat-glob "/path/to/mat/*.mat" \
  --elevation-tif /path/to/my_elevation.tif \
  --out /Users/pearloyewole/yukon/public/river-packages/my-river.json
```

The build script samples the raster to a browser-safe grid (configurable with `--elevation-max-grid`) and writes it to `elevation_raster` in the package.

## Notes

- Python dependencies used by the build script: `numpy`, `scipy`, `openpyxl`, `pyshp`, `tifffile`.
- Bank points are rendered with displacement-based elevation and outer/inner bend color.
- Cross-section markers are placed from overview UTM start/end coordinates.
