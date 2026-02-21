#!/usr/bin/env python3
import argparse
import glob
import os
from pathlib import Path

import numpy as np
import scipy.io as sio


def load_mat(path):
    return sio.loadmat(path, squeeze_me=True, struct_as_record=False)


def get_array(mat, key):
    if key not in mat:
        raise KeyError(f"Missing key '{key}' in mat file")
    arr = mat[key]
    arr = np.array(arr)
    if arr.ndim != 2:
        raise ValueError(f"Key '{key}' is not 2D (ndim={arr.ndim})")
    return arr


def write_csv(path, array):
    np.savetxt(path, array, delimiter=",", fmt="%.6g")


def main():
    parser = argparse.ArgumentParser(
        description="Convert .mat cross-section grids to CSV files for three.js viewer."
    )
    parser.add_argument("--input-glob", default="data/mat/*.mat", help="Glob for .mat files")
    parser.add_argument("--out-dir", default="cross_section_csvs", help="Output folder")
    parser.add_argument("--velocity-key", default="xsGridQs", help="2D velocity grid key")
    parser.add_argument("--mask-key", default="mask_temp", help="2D mask key (optional)")
    parser.add_argument("--prefix", default="huslia", help="Output filename prefix")
    parser.add_argument("--list-keys", action="store_true", help="Print keys and exit")
    args = parser.parse_args()

    files = sorted(glob.glob(args.input_glob))
    if not files:
        raise SystemExit(f"No files matched: {args.input_glob}")

    if args.list_keys:
        mat = load_mat(files[0])
        keys = [k for k in mat.keys() if not k.startswith("__")]
        print("Keys in", files[0])
        for k in keys:
            v = mat[k]
            try:
                shape = np.shape(v)
            except Exception:
                shape = "?"
            print(f"  {k}  shape={shape}")
        return

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_rows = []

    for i, path in enumerate(files, start=1):
        mat = load_mat(path)

        vel = get_array(mat, args.velocity_key)

        if args.mask_key and args.mask_key in mat:
            mask = get_array(mat, args.mask_key)
        else:
            mask = np.isfinite(vel).astype(float)

        vel_name = f"{args.prefix}_Qgrid_{i:02d}.csv"
        mask_name = f"{args.prefix}_mask_{i:02d}.csv"
        vel_path = out_dir / vel_name
        mask_path = out_dir / mask_name

        write_csv(vel_path, vel)
        write_csv(mask_path, mask)

        manifest_rows.append(
            [
                i,
                os.path.basename(path),
                vel.shape[0],
                vel.shape[1],
                args.velocity_key,
                args.mask_key if args.mask_key in mat else "",
                vel_name,
                mask_name,
            ]
        )

    manifest_path = out_dir / f"{args.prefix}_manifest.csv"
    header = [
        "slice_index",
        "source_file",
        "rows",
        "cols",
        "velocity_key",
        "mask_key",
        "velocity_csv",
        "mask_csv",
    ]
    np.savetxt(
        manifest_path,
        np.array(manifest_rows, dtype=object),
        delimiter=",",
        fmt="%s",
        header=",".join(header),
        comments="",
    )

    print(f"Wrote {len(files)} slice(s) to {out_dir}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
