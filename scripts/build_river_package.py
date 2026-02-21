#!/usr/bin/env python3
"""Build a browser-ready river package JSON from shapefile + overview workbook + MAT files.

Supports two modes:
- Explicit inputs (shp/dbf/shx + overview + mat glob)
- Zip bundle input (auto-detects components)
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import math
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import openpyxl
import scipy.io as sio

try:
    import shapefile  # pyshp
except ImportError as exc:
    raise SystemExit(
        "Missing dependency 'pyshp'. Install with: python -m pip install pyshp"
    ) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a single JSON package for the Three.js river viewer from a river dataset."
        )
    )
    parser.add_argument("--river-id", required=True, help="Short river identifier, e.g. huslia")
    parser.add_argument("--input-zip", help="Path to zip containing shapefile + overview xlsx + mat files")
    parser.add_argument("--shp", help="Path to .shp")
    parser.add_argument("--dbf", help="Path to .dbf (optional if same basename as .shp)")
    parser.add_argument("--shx", help="Path to .shx (optional if same basename as .shp)")
    parser.add_argument("--overview", help="Path to overview .xlsx")
    parser.add_argument("--mat-glob", default="data/mat/*.mat", help="Glob pattern for mat files")
    parser.add_argument(
        "--out",
        default=None,
        help="Output JSON path (default: public/river-packages/<river-id>.json)",
    )
    parser.add_argument(
        "--velocity-key",
        default="xsGridQs",
        help="MAT field for velocity grid",
    )
    parser.add_argument(
        "--mask-key",
        default="mask_temp",
        help="MAT field for mask grid",
    )
    parser.add_argument(
        "--sample-grid-size",
        type=int,
        default=24,
        help="Downsampled square size for velocity preview data",
    )
    return parser.parse_args()


def find_first(root: Path, pattern: str) -> Path | None:
    matches = sorted(root.rglob(pattern))
    return matches[0] if matches else None


def resolve_inputs(args: argparse.Namespace) -> tuple[Path, Path, Path, Path, list[Path], dict[str, str]]:
    source: dict[str, str] = {}

    if args.input_zip:
        input_zip = Path(args.input_zip).expanduser().resolve()
        if not input_zip.exists():
            raise SystemExit(f"Zip not found: {input_zip}")

        temp_dir = Path(tempfile.mkdtemp(prefix="river_pkg_"))
        with zipfile.ZipFile(input_zip, "r") as zf:
            zf.extractall(temp_dir)

        shp = find_first(temp_dir, "*.shp")
        dbf = find_first(temp_dir, "*.dbf")
        shx = find_first(temp_dir, "*.shx")
        overview = find_first(temp_dir, "*.xlsx")
        mat_files = sorted(temp_dir.rglob("*.mat"))

        if not shp or not dbf or not shx or not overview or not mat_files:
            raise SystemExit(
                "Zip must contain .shp/.dbf/.shx + overview .xlsx + one or more .mat files"
            )

        source.update(
            {
                "input_zip": str(input_zip),
                "extracted_dir": str(temp_dir),
            }
        )
        return shp, dbf, shx, overview, mat_files, source

    if not args.shp or not args.overview:
        raise SystemExit("Provide --input-zip OR explicit --shp and --overview inputs")

    shp = Path(args.shp).expanduser().resolve()
    if not shp.exists():
        raise SystemExit(f"Shapefile not found: {shp}")

    dbf = Path(args.dbf).expanduser().resolve() if args.dbf else shp.with_suffix(".dbf")
    shx = Path(args.shx).expanduser().resolve() if args.shx else shp.with_suffix(".shx")
    overview = Path(args.overview).expanduser().resolve()

    for p in [dbf, shx, overview]:
        if not p.exists():
            raise SystemExit(f"Required file not found: {p}")

    mat_files = [Path(p).resolve() for p in sorted(glob.glob(args.mat_glob))]
    if not mat_files:
        raise SystemExit(f"No MAT files matched: {args.mat_glob}")

    source.update(
        {
            "shp": str(shp),
            "dbf": str(dbf),
            "shx": str(shx),
            "overview": str(overview),
            "mat_glob": args.mat_glob,
        }
    )
    return shp, dbf, shx, overview, mat_files, source


def to_json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.floating, float)):
        val = float(value)
        return val if math.isfinite(val) else None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    return value


def normalize_header(name: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in name).strip("_")


def load_shapefile_points(shp: Path, dbf: Path, shx: Path) -> dict[str, Any]:
    reader = shapefile.Reader(str(shp), dbf=str(dbf), shx=str(shx))
    field_defs = reader.fields[1:]
    field_names = [f[0] for f in field_defs]

    points: list[dict[str, Any]] = []

    for shape_record in reader.iterShapeRecords():
        shape = shape_record.shape
        record = shape_record.record

        attrs = {field_names[i]: to_json_value(record[i]) for i in range(len(field_names))}

        for xy in shape.points:
            point = {
                "x": float(xy[0]),
                "y": float(xy[1]),
                "attrs": attrs,
            }
            points.append(point)

    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]

    return {
        "point_count": len(points),
        "fields": field_names,
        "bbox": {
            "min_x": min(xs) if xs else None,
            "max_x": max(xs) if xs else None,
            "min_y": min(ys) if ys else None,
            "max_y": max(ys) if ys else None,
        },
        "points": points,
    }


def load_overview_rows(overview_path: Path) -> tuple[list[dict[str, Any]], str]:
    wb = openpyxl.load_workbook(overview_path, data_only=True, read_only=True)
    sheet_name = "Data" if "Data" in wb.sheetnames else wb.sheetnames[0]
    ws = wb[sheet_name]

    rows = ws.iter_rows(values_only=True)
    header = next(rows)
    if not header:
        return [], sheet_name

    headers = [str(h).strip() if h is not None else "" for h in header]
    normalized_headers = [normalize_header(h) for h in headers]

    parsed: list[dict[str, Any]] = []
    for row in rows:
        if row is None:
            continue

        record: dict[str, Any] = {}
        empty = True
        for idx, cell in enumerate(row):
            if idx >= len(headers):
                break
            key = headers[idx]
            norm_key = normalized_headers[idx]
            value = to_json_value(cell)
            record[key] = value
            record[norm_key] = value
            if value not in (None, ""):
                empty = False

        if not empty:
            parsed.append(record)

    return parsed, sheet_name


def downsample_2d(arr: np.ndarray, target_size: int) -> list[list[float | None]]:
    if arr.ndim != 2:
        return []

    rows, cols = arr.shape
    row_idx = np.linspace(0, rows - 1, min(target_size, rows)).astype(int)
    col_idx = np.linspace(0, cols - 1, min(target_size, cols)).astype(int)
    sample = arr[np.ix_(row_idx, col_idx)]

    out: list[list[float | None]] = []
    for r in sample:
        row_out: list[float | None] = []
        for v in r:
            fv = float(v)
            row_out.append(fv if math.isfinite(fv) else None)
        out.append(row_out)
    return out


def safe_minmaxmean(arr: np.ndarray) -> dict[str, float | None]:
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return {"min": None, "max": None, "mean": None}
    return {
        "min": float(np.min(finite)),
        "max": float(np.max(finite)),
        "mean": float(np.mean(finite)),
    }


def load_mat_summary(path: Path, velocity_key: str, mask_key: str, sample_grid_size: int) -> dict[str, Any]:
    mat = sio.loadmat(path, squeeze_me=True, struct_as_record=False)

    result: dict[str, Any] = {
        "source_file": path.name,
        "available_keys": sorted([k for k in mat.keys() if not k.startswith("__")]),
    }

    vel = np.array(mat.get(velocity_key)) if velocity_key in mat else None
    mask = np.array(mat.get(mask_key)) if mask_key in mat else None
    xinterp = np.array(mat.get("xinterp")) if "xinterp" in mat else None
    zinterp = np.array(mat.get("zinterp")) if "zinterp" in mat else None

    if vel is not None and vel.ndim == 2:
        result["velocity"] = {
            "rows": int(vel.shape[0]),
            "cols": int(vel.shape[1]),
            "stats": safe_minmaxmean(vel),
            "sample": downsample_2d(vel, sample_grid_size),
        }
    else:
        result["velocity"] = None

    if mask is not None and mask.ndim == 2:
        mask_float = mask.astype(float)
        result["mask"] = {
            "rows": int(mask.shape[0]),
            "cols": int(mask.shape[1]),
            "water_fraction": float(np.mean(mask_float > 0.5)),
            "sample": downsample_2d(mask_float, sample_grid_size),
        }
    else:
        result["mask"] = None

    if xinterp is not None:
        xinterp = np.array(xinterp).astype(float).flatten()
        result["xinterp"] = [float(v) if math.isfinite(v) else None for v in xinterp]
    else:
        result["xinterp"] = None

    if zinterp is not None:
        zinterp = np.array(zinterp).astype(float).flatten()
        result["zinterp"] = [float(v) if math.isfinite(v) else None for v in zinterp]
        finite = zinterp[np.isfinite(zinterp)]
        result["z_stats"] = {
            "min": float(np.min(finite)) if finite.size else None,
            "max": float(np.max(finite)) if finite.size else None,
            "mean": float(np.mean(finite)) if finite.size else None,
        }
    else:
        result["zinterp"] = None
        result["z_stats"] = None

    return result


def build_cross_sections(
    overview_rows: list[dict[str, Any]],
    mat_summaries: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    by_name = {}
    for row in overview_rows:
        key = row.get("processed_mat_file_name")
        if key:
            by_name[str(key)] = row

    sections: list[dict[str, Any]] = []

    for i, (mat_name, summary) in enumerate(sorted(mat_summaries.items()), start=1):
        row = by_name.get(mat_name, {})

        sx = row.get("cross_section_start_x__utm")
        sy = row.get("cross_section_start_y__utm")
        ex = row.get("cross_section_end_x__utm")
        ey = row.get("cross_section_end_y__utm")

        has_line = all(v is not None for v in [sx, sy, ex, ey])

        center_x = None
        center_y = None
        if has_line:
            center_x = float(sx + ex) / 2.0
            center_y = float(sy + ey) / 2.0

        sections.append(
            {
                "id": i,
                "mat_file": mat_name,
                "transect": row.get("transect"),
                "description": row.get("description"),
                "date": row.get("date"),
                "time_local": row.get("time__local"),
                "start_lat": row.get("start_latitude"),
                "start_lon": row.get("start_longitude"),
                "end_lat": row.get("end_latitude"),
                "end_lon": row.get("end_longitude"),
                "Q_m3s": row.get("q__m3_s"),
                "B_m": row.get("b__m"),
                "T_m": row.get("t__m"),
                "U_ms": row.get("u__m_s"),
                "line": {
                    "start_x": sx,
                    "start_y": sy,
                    "end_x": ex,
                    "end_y": ey,
                    "has_geometry": has_line,
                },
                "center": {
                    "x": center_x,
                    "y": center_y,
                },
                "mat_summary": summary,
            }
        )

    return sections


def main() -> None:
    args = parse_args()

    shp, dbf, shx, overview, mat_files, source = resolve_inputs(args)

    print(f"Loading shapefile: {shp.name}")
    river_banks = load_shapefile_points(shp, dbf, shx)
    print(f"  points: {river_banks['point_count']}")

    print(f"Loading overview: {overview.name}")
    overview_rows, sheet_name = load_overview_rows(overview)
    print(f"  rows: {len(overview_rows)} (sheet: {sheet_name})")

    print(f"Loading MAT summaries ({len(mat_files)} files)")
    mat_summaries: dict[str, dict[str, Any]] = {}
    for idx, mat_path in enumerate(mat_files, start=1):
        if idx % 25 == 0 or idx == 1 or idx == len(mat_files):
            print(f"  {idx}/{len(mat_files)}: {mat_path.name}")
        try:
            mat_summaries[mat_path.name] = load_mat_summary(
                mat_path,
                velocity_key=args.velocity_key,
                mask_key=args.mask_key,
                sample_grid_size=args.sample_grid_size,
            )
        except Exception as exc:
            mat_summaries[mat_path.name] = {
                "source_file": mat_path.name,
                "error": str(exc),
            }

    cross_sections = build_cross_sections(overview_rows, mat_summaries)

    package = {
        "river_id": args.river_id,
        "generated_at_utc": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
        "source": source,
        "overview": {
            "path": str(overview),
            "sheet": sheet_name,
            "row_count": len(overview_rows),
        },
        "river_banks": river_banks,
        "cross_sections": cross_sections,
    }

    out = (
        Path(args.out).expanduser().resolve()
        if args.out
        else (Path("public") / "river-packages" / f"{args.river_id}.json").resolve()
    )
    out.parent.mkdir(parents=True, exist_ok=True)

    with out.open("w", encoding="utf-8") as f:
        json.dump(package, f, ensure_ascii=True, separators=(",", ":"))

    placed = sum(1 for cs in cross_sections if cs["line"]["has_geometry"])
    print(f"Wrote package: {out}")
    print(f"Cross-sections: {len(cross_sections)} total, {placed} with geometry")


if __name__ == "__main__":
    main()
