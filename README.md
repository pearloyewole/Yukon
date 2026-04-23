# Yukon River 3D Viewer (Huslia First)

This project now uses a **prebuilt river package JSON** that combines:
- bank shapefile data (`.shp/.dbf/.shx`)
- cross-section overview workbook (`.xlsx`)
- cross-section MAT files (`.mat`)

The Three.js app renders the river in 3D and lets you click cross-section markers to inspect metadata and flow/depth summary.

## Quick start

```bash
cd /Users/pearloyewole/yukon
npm install

python /Users/pearloyewole/yukon/scripts/build_river_package.py \
  --river-id huslia \
  --shp /Users/pearloyewole/yukon/Huslia.shp \
  --dbf /Users/pearloyewole/yukon/Huslia.dbf \
  --shx /Users/pearloyewole/yukon/Huslia.shx \
  --overview /Users/pearloyewole/yukon/ADCP_Huslia_All_overview.xlsx \
  --mat-glob "/Users/pearloyewole/yukon/data/mat/*.mat" \
  --sonar-zip /Users/pearloyewole/yukon/Huslia_sonar.zip \
  --elevation-tif /Users/pearloyewole/yukon/__MACOSX/HUSLIA_GEG_01M.tif \
  --out /Users/pearloyewole/yukon/public/river-packages/huslia.json

npm run dev
```

Open the printed Vite URL.

## In-app upload pipeline

The upload flow in `log-analysis.html` now compiles packages by running
[`scripts/build_river_package.py`](/Users/pearloyewole/yukon/scripts/build_river_package.py)
through a Vite API endpoint (`POST /api/compile-river-package`), instead of
parsing shapefiles/MAT data in the browser.

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
