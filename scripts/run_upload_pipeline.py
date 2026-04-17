#!/usr/bin/env python3
"""Prepare uploaded files and run build_river_package.py in explicit-input mode."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare uploaded files and execute build_river_package.py"
    )
    parser.add_argument("--manifest", required=True, help="Path to upload manifest JSON")
    parser.add_argument("--river-id", required=True, help="River identifier")
    parser.add_argument("--out", required=True, help="Output JSON path")
    return parser.parse_args()


def read_manifest(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise SystemExit("Upload manifest must be a JSON object.")
    return data


def sanitize_name(name: str) -> str:
    raw = Path(name).name
    cleaned = "".join(ch if (ch.isalnum() or ch in ("-", "_", ".")) else "_" for ch in raw)
    return cleaned or "upload.bin"


def copy_unique(src: Path, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = sanitize_name(src.name)
    candidate = dest_dir / safe_name
    if not candidate.exists():
        shutil.copy2(src, candidate)
        return candidate

    stem = candidate.stem
    suffix = candidate.suffix
    for idx in range(1, 10000):
        alt = dest_dir / f"{stem}_{idx:03d}{suffix}"
        if alt.exists():
            continue
        shutil.copy2(src, alt)
        return alt
    raise SystemExit(f"Unable to find unique destination name for {src}")


def unzip_to_dir(zip_path: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest_dir)


def should_skip(path: Path) -> bool:
    parts = {part.lower() for part in path.parts}
    if "__macosx" in parts:
        return True
    if path.name.startswith("."):
        return True
    return False


def gather_paths(paths: list[Path], suffix: str) -> list[Path]:
    out: list[Path] = []
    wanted = suffix.lower()
    for item in paths:
        if not item.exists():
            continue
        if item.is_dir():
            for child in sorted(item.rglob("*")):
                if not child.is_file() or should_skip(child):
                    continue
                if child.suffix.lower() == wanted:
                    out.append(child.resolve())
        elif item.is_file():
            if should_skip(item):
                continue
            if item.suffix.lower() == wanted:
                out.append(item.resolve())
    return out


def choose_shapefile_components(paths: list[Path]) -> tuple[Path, Path, Path]:
    shp_files = gather_paths(paths, ".shp")
    dbf_files = gather_paths(paths, ".dbf")
    shx_files = gather_paths(paths, ".shx")

    if not shp_files:
        raise SystemExit("No .shp file was found in uploaded shapefile inputs.")
    if not dbf_files:
        raise SystemExit("No .dbf file was found in uploaded shapefile inputs.")
    if not shx_files:
        raise SystemExit("No .shx file was found in uploaded shapefile inputs.")

    for shp in shp_files:
        stem = shp.stem.lower()
        dbf_match = next((p for p in dbf_files if p.stem.lower() == stem), None)
        shx_match = next((p for p in shx_files if p.stem.lower() == stem), None)
        if dbf_match and shx_match:
            return shp, dbf_match, shx_match

    return shp_files[0], dbf_files[0], shx_files[0]


def normalize_path_list(raw_values: object) -> list[Path]:
    if not isinstance(raw_values, list):
        return []
    out: list[Path] = []
    for value in raw_values:
        if not isinstance(value, str):
            continue
        p = Path(value).expanduser().resolve()
        if p.exists():
            out.append(p)
    return out


def collect_mat_files(mat_inputs: list[Path], workspace: Path) -> list[Path]:
    extracted_roots: list[Path] = []
    direct_mats: list[Path] = []

    for idx, item in enumerate(mat_inputs):
        if item.suffix.lower() == ".zip":
            extract_dir = workspace / "mat_extracted" / f"zip_{idx:03d}"
            unzip_to_dir(item, extract_dir)
            extracted_roots.append(extract_dir)
        elif item.suffix.lower() == ".mat":
            direct_mats.append(item.resolve())

    mats = direct_mats + gather_paths(extracted_roots, ".mat")
    if not mats:
        raise SystemExit("No .mat files were found in uploaded MATLAB inputs.")

    unique = list(dict.fromkeys(mats))
    mat_flat_dir = workspace / "mat_flat"
    mat_flat_dir.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    for mat in unique:
        copied.append(copy_unique(mat, mat_flat_dir))
    return copied


def main() -> None:
    args = parse_args()
    manifest = read_manifest(Path(args.manifest).resolve())

    overview_value = manifest.get("overview_file")
    if not isinstance(overview_value, str):
        raise SystemExit("Manifest is missing overview_file.")
    overview_path = Path(overview_value).expanduser().resolve()
    if not overview_path.exists():
        raise SystemExit(f"Overview file does not exist: {overview_path}")

    shp_inputs = normalize_path_list(manifest.get("shp_files"))
    mat_inputs = normalize_path_list(manifest.get("mat_files"))
    sonar_inputs = normalize_path_list(manifest.get("sonar_files"))
    if not shp_inputs:
        raise SystemExit("No shapefile uploads were provided.")
    if not mat_inputs:
        raise SystemExit("No MATLAB uploads were provided.")

    out_path = Path(args.out).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="yukon_upload_prepare_") as temp_dir:
        workspace = Path(temp_dir).resolve()

        shape_sources: list[Path] = []
        for idx, item in enumerate(shp_inputs):
            if item.suffix.lower() == ".zip":
                extract_dir = workspace / "shape_extracted" / f"zip_{idx:03d}"
                unzip_to_dir(item, extract_dir)
                shape_sources.append(extract_dir)
            else:
                shape_sources.append(item)

        shp_path, dbf_path, shx_path = choose_shapefile_components(shape_sources)
        shape_flat = workspace / "shape_flat"
        shape_flat.mkdir(parents=True, exist_ok=True)
        shp_copy = copy_unique(shp_path, shape_flat)
        dbf_copy = copy_unique(dbf_path, shape_flat)
        shx_copy = copy_unique(shx_path, shape_flat)

        mat_copies = collect_mat_files(mat_inputs, workspace)
        mat_glob = str((mat_copies[0].parent / "*.mat").resolve())

        sonar_zip_files: list[Path] = []
        sonar_csv_files: list[Path] = []
        for item in sonar_inputs:
            ext = item.suffix.lower()
            if ext == ".zip":
                sonar_zip_files.append(item)
            elif ext == ".csv":
                sonar_csv_files.append(item)

        sonar_csv_glob = None
        if sonar_csv_files:
            sonar_dir = workspace / "sonar_csv"
            sonar_dir.mkdir(parents=True, exist_ok=True)
            for csv_file in sonar_csv_files:
                copy_unique(csv_file, sonar_dir)
            sonar_csv_glob = str((sonar_dir / "*.csv").resolve())

        build_script = Path(__file__).with_name("build_river_package.py").resolve()
        cmd = [
            sys.executable,
            str(build_script),
            "--river-id",
            args.river_id,
            "--shp",
            str(shp_copy),
            "--dbf",
            str(dbf_copy),
            "--shx",
            str(shx_copy),
            "--overview",
            str(overview_path),
            "--mat-glob",
            mat_glob,
            "--out",
            str(out_path),
        ]

        for sonar_zip in sonar_zip_files:
            cmd.extend(["--sonar-zip", str(sonar_zip)])
        if sonar_csv_glob:
            cmd.extend(["--sonar-csv-glob", sonar_csv_glob])

        proc = subprocess.run(cmd, text=True, capture_output=True)
        if proc.stdout:
            sys.stdout.write(proc.stdout)
        if proc.stderr:
            sys.stderr.write(proc.stderr)

        if proc.returncode != 0:
            raise SystemExit(proc.returncode)


if __name__ == "__main__":
    main()
