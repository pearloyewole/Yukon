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
  --out /Users/pearloyewole/yukon/public/river-packages/huslia.json

npm run dev
```

Open the printed Vite URL.

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

Then load that JSON from the file picker in the app, or set it as default in `/Users/pearloyewole/yukon/src/main.js`.

## Notes

- Python dependencies used by the build script: `numpy`, `scipy`, `openpyxl`, `pyshp`.
- Bank points are rendered with displacement-based elevation and outer/inner bend color.
- Cross-section markers are placed from overview UTM start/end coordinates.
