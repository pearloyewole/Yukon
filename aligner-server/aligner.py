#!/usr/bin/env python3
"""
Yukon Aligner — river timelapse alignment and change detection
==============================================================
Run:  python3 aligner.py
Then open: http://localhost:3000
"""

import os, sys, json, base64, glob, threading, time, re, io, traceback, subprocess
from datetime import datetime as _dt, timedelta as _td
from collections import defaultdict as _defaultdict
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

# ──────────────────────────────────────────────
# ALIGNMENT ENGINE
# ──────────────────────────────────────────────

def load_image_rgb(path: str) -> np.ndarray:
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

def load_image_bgr(path: str) -> np.ndarray:
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Cannot read image: {path}")
    return img

def create_mask_from_rois(shape, rois):
    """rois: list of {x,y,w,h} dicts (in 0-1 normalised coords)"""
    h, w = shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    for roi in rois:
        x1 = int(roi['x'] * w);  y1 = int(roi['y'] * h)
        x2 = int((roi['x']+roi['w']) * w); y2 = int((roi['y']+roi['h']) * h)
        mask[y1:y2, x1:x2] = 255
    return mask

# Scale factor used for alignment computation.
# We detect features and estimate the transform on a downscaled copy of the
# image (much faster, avoids ECC-style divergence, and SIFT scale-space is
# better calibrated for smaller pixel motions).  The resulting matrix is then
# scaled back and applied to the full-resolution image.
ALIGN_SCALE = 0.25   # 6000×4000 → 1500×1000


def build_static_mask(shape, roi_masks=None, sky_frac: float = 0.08,
                      water_frac: float = 0.15):
    """
    Build an 8-bit mask (255 = use, 0 = ignore) that covers the stable
    mid-band of the frame.
    - Excludes the top   sky_frac   fraction  (sky + clouds)
    - Excludes the bottom water_frac fraction  (water surface + ripples)
    - If roi_masks are provided those rectangles replace the auto-band.
    """
    h, w = shape[:2]
    if roi_masks:
        return create_mask_from_rois(shape, roi_masks)
    mask = np.zeros((h, w), dtype=np.uint8)
    y_top = int(h * sky_frac)
    y_bot = int(h * (1.0 - water_frac))
    mask[y_top:y_bot, :] = 255
    return mask


def preprocess_gray(bgr: np.ndarray) -> np.ndarray:
    """
    CLAHE-enhanced grayscale so SIFT finds consistent keypoints regardless
    of lighting differences between frames taken at different times of day.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _sym_good_matches(des_ref, des_tgt, ratio: float = 0.75):
    """
    Symmetric FLANN matching:
      1. Lowe ratio test in the forward direction (ref → tgt)
      2. Lowe ratio test in the reverse direction (tgt → ref)
      3. Keep only mutually consistent pairs

    Returns a list of forward DMatch objects whose pairs are symmetric.
    """
    if des_ref is None or des_tgt is None or len(des_ref) < 8 or len(des_tgt) < 8:
        return []
    idx_params    = dict(algorithm=1, trees=8)
    search_params = dict(checks=100)
    flann = cv2.FlannBasedMatcher(idx_params, search_params)
    try:
        fwd = flann.knnMatch(des_ref, des_tgt, k=2)
        bwd = flann.knnMatch(des_tgt, des_ref, k=2)
    except cv2.error:
        return []

    good_fwd = {m.trainIdx: m for m, n in fwd
                if len([m, n]) == 2 and m.distance < ratio * n.distance}
    good_bwd = {m.trainIdx: m.queryIdx for m, n in bwd
                if len([m, n]) == 2 and m.distance < ratio * n.distance}

    # Keep only matches that are consistent in both directions
    symmetric = [m for tgt_idx, m in good_fwd.items()
                 if tgt_idx in good_bwd and good_bwd[tgt_idx] == m.queryIdx]

    # If symmetry filtering is too strict, fall back to ratio-only
    if len(symmetric) < 15:
        symmetric = list(good_fwd.values())
    return symmetric


def estimate_transform(kp_ref, kp_tgt, good, min_inliers: int = 8):
    """
    Estimate the best rigid-ish transform from target → reference.

    Priority (most constrained first = most robust for camera tilt):
      1. Similarity  (scale + rotation + tx/ty  — 4 DOF)
      2. Full affine (6 DOF)
      3. Homography  (8 DOF, last resort)

    Returns (M, kind).  M is a 2×3 or 3×3 float64 array, kind is a string.
    Both are None when no reliable transform can be found.
    """
    if len(good) < min_inliers:
        return None, None

    src = np.float32([kp_tgt[m.trainIdx].pt for m in good])
    dst = np.float32([kp_ref[m.queryIdx].pt for m in good])

    # 1 — similarity
    M, inliers = cv2.estimateAffinePartial2D(
        src, dst,
        method=cv2.RANSAC,
        ransacReprojThreshold=2.0,
        maxIters=10_000,
        confidence=0.9999,
    )
    n_in = int(inliers.sum()) if inliers is not None else 0
    if M is not None and n_in >= min_inliers:
        return M, 'similarity'

    # 2 — full affine
    M, inliers = cv2.estimateAffine2D(
        src, dst,
        method=cv2.RANSAC,
        ransacReprojThreshold=3.0,
        maxIters=5_000,
        confidence=0.999,
    )
    n_in = int(inliers.sum()) if inliers is not None else 0
    if M is not None and n_in >= min_inliers:
        return M, 'affine'

    # 3 — homography
    H, hmask = cv2.findHomography(
        src.reshape(-1, 1, 2), dst.reshape(-1, 1, 2),
        cv2.RANSAC, 4.0, maxIters=5_000, confidence=0.999,
    )
    n_in = int(hmask.sum()) if hmask is not None else 0
    if H is not None and n_in >= min_inliers:
        return H, 'homography'

    return None, None


def scale_matrix_to_fullres(M: np.ndarray, scale: float) -> np.ndarray:
    """
    Convert a 2×3 affine/similarity matrix estimated on a downscaled image
    back to the coordinate space of the full-resolution image.

    For any 2×3 matrix  [[a, b, tx], [c, d, ty]]  estimated at factor `scale`:
      - Linear part (a, b, c, d) is dimensionless — unchanged.
      - Translation (tx, ty) is in down-scaled pixels — divide by scale.
    """
    M_full = M.astype(np.float64).copy()
    M_full[0, 2] /= scale
    M_full[1, 2] /= scale
    return M_full


def align_images(paths: list[str], roi_masks=None, progress_cb=None,
                 use_ecc: bool = False) -> list[np.ndarray]:
    """
    Align all images to the first (reference) image.

    Design:
    - Feature detection and transform estimation run on images downscaled to
      ALIGN_SCALE (default 0.25×).  At 6000×4000 this gives 1500×1000, which
      is the right operating range for SIFT and RANSAC.  The recovered matrix
      is then scaled back and applied to the full-resolution source.
    - Similarity transform (4 DOF) is tried first.  It handles camera tilt
      (rotation + slight translation/scale) without the fragility of an 8-DOF
      homography.
    - Auto-mask excludes the very top (sky/clouds) and very bottom
      (water surface) so features are found on the stable bank walls.
    - Symmetric matching removes most false correspondences before RANSAC.
    - ECC is intentionally NOT used: it diverges on high-resolution images
      with even a slightly wrong initial estimate and is counter-productive.

    roi_masks : optional list of {x,y,w,h} normalised rects (user-drawn ROIs).
    use_ecc   : kept as kwarg for UI compatibility but has no effect.
    Returns list of RGB numpy arrays at the original full resolution.
    """
    if not paths:
        return []

    ref_bgr = load_image_bgr(paths[0])
    ref_rgb = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2RGB)
    H_full, W_full = ref_bgr.shape[:2]

    # ── downscaled reference for feature work ──────────────────────────────
    W_s = int(W_full * ALIGN_SCALE)
    H_s = int(H_full * ALIGN_SCALE)
    ref_small = cv2.resize(ref_bgr, (W_s, H_s), interpolation=cv2.INTER_AREA)
    ref_gray_s = preprocess_gray(ref_small)

    feat_mask_s = build_static_mask(ref_small.shape, roi_masks)

    sift = cv2.SIFT_create(nfeatures=4000, contrastThreshold=0.03, edgeThreshold=10)
    kp_ref, des_ref = sift.detectAndCompute(ref_gray_s, feat_mask_s)
    print(f"  [ref] {len(kp_ref)} keypoints in {Path(paths[0]).name}")

    aligned = [ref_rgb]

    for i, path in enumerate(paths[1:], 1):
        if progress_cb:
            progress_cb(i, len(paths) - 1, f"Aligning {Path(path).name}")
        try:
            tgt_bgr  = load_image_bgr(path)
            # Resize to match reference dimensions if needed
            if tgt_bgr.shape[:2] != (H_full, W_full):
                tgt_bgr = cv2.resize(tgt_bgr, (W_full, H_full),
                                     interpolation=cv2.INTER_AREA)

            tgt_small  = cv2.resize(tgt_bgr, (W_s, H_s),
                                    interpolation=cv2.INTER_AREA)
            tgt_gray_s = preprocess_gray(tgt_small)

            kp_tgt, des_tgt = sift.detectAndCompute(tgt_gray_s, feat_mask_s)

            # Symmetric matching — starts strict (0.72), relaxes if needed
            good = _sym_good_matches(des_ref, des_tgt, ratio=0.72)
            if len(good) < 15:
                good = _sym_good_matches(des_ref, des_tgt, ratio=0.80)

            M_s, kind = estimate_transform(kp_ref, kp_tgt, good)

            if M_s is None:
                print(f"  [warn] no valid transform for {Path(path).name}"
                      f" ({len(good)} matches) — using original")
                aligned.append(cv2.cvtColor(tgt_bgr, cv2.COLOR_BGR2RGB))
                continue

            if kind == 'homography':
                # Homography encodes scale differently; handle separately
                # Build the full-res version by sandwiching with scale matrices
                S  = np.diag([1/ALIGN_SCALE, 1/ALIGN_SCALE, 1.0])
                Si = np.diag([ALIGN_SCALE,   ALIGN_SCALE,   1.0])
                M_full_H = S @ M_s @ Si
                warped = cv2.warpPerspective(
                    tgt_bgr, M_full_H, (W_full, H_full),
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REFLECT_101)
            else:
                M_full = scale_matrix_to_fullres(M_s, ALIGN_SCALE)
                warped = cv2.warpAffine(
                    tgt_bgr, M_full, (W_full, H_full),
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REFLECT_101)

            # Count inliers for diagnostics
            src_s = np.float32([kp_tgt[m.trainIdx].pt for m in good]).reshape(-1,1,2)
            dst_s = np.float32([kp_ref[m.queryIdx].pt for m in good]).reshape(-1,1,2)
            if kind != 'homography':
                proj  = cv2.transform(src_s, M_s)
                errs  = np.linalg.norm((proj - dst_s).reshape(-1, 2), axis=1)
                n_in  = int((errs < 3.0).sum())
            else:
                n_in = len(good)
            print(f"  [{kind:10s}] {Path(path).name}: "
                  f"{len(good)} matches → {n_in} inliers")

            aligned.append(cv2.cvtColor(warped, cv2.COLOR_BGR2RGB))

        except Exception as e:
            print(f"  [warn] alignment failed for {path}: {e}")
            aligned.append(ref_rgb.copy())

    return aligned

def crop_to_roi(images: list[np.ndarray], roi: dict) -> list[np.ndarray]:
    """Crop all images to a single normalised ROI."""
    cropped = []
    for img in images:
        h, w = img.shape[:2]
        x1 = int(roi['x'] * w);  y1 = int(roi['y'] * h)
        x2 = int((roi['x']+roi['w']) * w); y2 = int((roi['y']+roi['h']) * h)
        cropped.append(img[y1:y2, x1:x2])
    return cropped

_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
           'Jul','Aug','Sep','Oct','Nov','Dec']

# EXIF tag IDs
_TAG_DTO = 36867   # DateTimeOriginal
_TAG_DT  = 306     # DateTime

def _load_font(size: int) -> ImageFont.FreeTypeFont:
    """Try common system font paths; fall back to PIL default."""
    candidates = [
        "/System/Library/Fonts/Helvetica.ttc",          # macOS
        "/Library/Fonts/Arial Bold.ttf",                # macOS extras
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",                 # Windows
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

def _tiff_datetime(tiff: bytes) -> str | None:
    """
    Parse a raw TIFF block (starting at the byte-order mark) and return
    the first datetime string found in DateTimeOriginal (36867),
    DateTimeDigitized (36868), or DateTime (306).
    """
    import struct as _s
    try:
        bo = '<' if tiff[:2] == b'II' else '>'
        if _s.unpack_from(bo + 'H', tiff, 2)[0] != 42:
            return None

        def read_ascii(off, cnt):
            if cnt <= 4:
                raw = tiff[off: off + cnt]
            else:
                data_off = _s.unpack_from(bo + 'I', tiff, off)[0]
                raw = tiff[data_off: data_off + cnt]
            return raw.decode('ascii', errors='ignore').rstrip('\x00 ')

        def scan_ifd(ifd_off, target_tags):
            n = _s.unpack_from(bo + 'H', tiff, ifd_off)[0]
            results = {}
            for i in range(n):
                e = ifd_off + 2 + i * 12
                tag = _s.unpack_from(bo + 'H', tiff, e)[0]
                typ = _s.unpack_from(bo + 'H', tiff, e + 2)[0]
                cnt = _s.unpack_from(bo + 'I', tiff, e + 4)[0]
                if tag in target_tags and typ == 2:   # ASCII
                    results[tag] = read_ascii(e + 8, cnt)
                elif tag == 0x8769 and typ == 4:       # ExifIFD pointer
                    results['exif_ptr'] = _s.unpack_from(bo + 'I', tiff, e + 8)[0]
            return results

        ifd0 = _s.unpack_from(bo + 'I', tiff, 4)[0]
        r0 = scan_ifd(ifd0, {306})

        # Prefer DateTimeOriginal from ExifIFD
        if 'exif_ptr' in r0:
            r1 = scan_ifd(r0['exif_ptr'], {36867, 36868})
            for tag in (36867, 36868):
                v = r1.get(tag, '')
                if len(v) >= 10 and v[4] == ':':
                    return v

        v = r0.get(306, '')
        if len(v) >= 10 and v[4] == ':':
            return v
    except Exception:
        pass
    return None


def read_exif_datetime(path: str) -> str | None:
    """
    Return 'YYYY:MM:DD HH:MM:SS' straight from the JPEG binary.

    Reads the raw APP1/EXIF bytes without relying on Pillow's EXIF API
    or any external tool — works on every platform and every Pillow version.
    """
    try:
        with open(path, 'rb') as f:
            # Must start with JPEG SOI
            if f.read(2) != b'\xff\xd8':
                return None
            # Scan markers until we find APP1 (FF E1) with "Exif" header
            while True:
                b = f.read(1)
                if not b:
                    break
                if b != b'\xff':
                    continue
                marker = f.read(1)
                if not marker:
                    break
                m = marker[0]
                if m == 0xD9:                  # EOI — give up
                    break
                if m in range(0xD0, 0xD8):     # RST — no length bytes
                    continue
                seg_len = int.from_bytes(f.read(2), 'big') - 2
                if seg_len < 0:
                    break
                if m == 0xE1:                  # APP1
                    hdr = f.read(6)
                    if hdr == b'Exif\x00\x00':
                        tiff = f.read(seg_len - 6)
                        result = _tiff_datetime(tiff)
                        if result:
                            return result
                    break
                f.seek(seg_len, 1)             # skip this segment
    except Exception as e:
        print(f"  [exif] {Path(path).name}: {e}", flush=True)
    return None

def _parse_exif_dt(raw: str):
    """
    Parse 'YYYY:MM:DD HH:MM:SS' into (date_str, time_str).
    Returns ('28 Sep 2022', '08:20:31') or (raw, '') on failure.
    """
    try:
        date_part, time_part = raw.strip().split(' ', 1)
        y, m, d = date_part.split(':')
        mon = _MONTHS[int(m) - 1]
        hh, mm, ss = time_part.split(':')
        return f"{int(d):02d} {mon} {y}", f"{hh}:{mm}:{ss}"
    except Exception:
        return raw, ''

def make_labels(paths: list[str]) -> list[str]:
    """
    Return one label per image.
    Reads EXIF DateTimeOriginal first; falls back to the filename stem.
    Label format: 'DD Mon YYYY|HH:MM:SS'  (pipe separates date from time).
    """
    labels = []
    for i, p in enumerate(paths):
        raw = read_exif_datetime(p)
        if i == 0:
            print(f"  [label] {Path(p).name} → exif={raw!r}", flush=True)
        if raw:
            date_s, time_s = _parse_exif_dt(raw)
            labels.append(f"{date_s}|{time_s}")
        else:
            stem = Path(p).stem.replace('_', ' ').replace('-', ' ')
            labels.append(stem)
    return labels

def add_timestamp(img_pil: Image.Image, label: str) -> Image.Image:
    """
    Burn a date + time badge into the bottom-left corner.

    Expected label formats:
      '28 Sep 2022|08:20:31'   → date on line 1, time on line 2
      any other string         → single line
    """
    w, h = img_pil.size
    margin = max(10, w // 90)
    pad    = max(6,  w // 140)

    if '|' in label:
        date_str, time_str = label.split('|', 1)
    else:
        date_str, time_str = label, ''

    time_sz = max(16, h // 24)   # larger — the clock is the star
    date_sz = max(11, h // 40)   # smaller, quieter

    font_time = _load_font(time_sz)
    font_date = _load_font(date_sz)

    draw_tmp = ImageDraw.Draw(img_pil)

    bb_time = draw_tmp.textbbox((0, 0), time_str or date_str, font=font_time)
    tw_t = bb_time[2] - bb_time[0]
    th_t = bb_time[3] - bb_time[1]

    if time_str:
        bb_date = draw_tmp.textbbox((0, 0), date_str, font=font_date)
        tw_d = bb_date[2] - bb_date[0]
        th_d = bb_date[3] - bb_date[1]
        gap   = max(3, h // 120)
        box_w = max(tw_t, tw_d) + pad * 2
        box_h = th_d + gap + th_t + pad * 2
    else:
        tw_d = th_d = gap = 0
        box_w = tw_t + pad * 2
        box_h = th_t + pad * 2

    x = margin
    y = h - box_h - margin

    # Semi-transparent rounded background
    overlay = Image.new('RGBA', img_pil.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    try:
        od.rounded_rectangle(
            [x - pad, y - pad, x + box_w, y + box_h],
            radius=max(4, pad), fill=(0, 0, 0, 175))
    except AttributeError:
        od.rectangle(
            [x - pad, y - pad, x + box_w, y + box_h],
            fill=(0, 0, 0, 175))
    img_pil = Image.alpha_composite(img_pil, overlay)

    draw = ImageDraw.Draw(img_pil)
    if time_str:
        # Date: muted grey-blue
        draw.text((x, y), date_str, fill=(160, 195, 210, 255), font=font_date)
        # Time: warm white  — prominent
        draw.text((x, y + th_d + gap), time_str, fill=(255, 245, 190, 255), font=font_time)
    else:
        draw.text((x, y), date_str, fill=(255, 245, 190, 255), font=font_time)

    return img_pil

def frames_to_gif(frames: list[np.ndarray], labels: list[str],
                  output_path: str, fps: int = 4, resize_width: int = 900):
    pil_frames = []
    for img, label in zip(frames, labels):
        h, w = img.shape[:2]
        scale = resize_width / w
        new_w, new_h = resize_width, int(h * scale)
        pil_img = Image.fromarray(img).resize((new_w, new_h), Image.LANCZOS).convert("RGBA")
        pil_img = add_timestamp(pil_img, label)
        pil_frames.append(pil_img.convert("P", palette=Image.ADAPTIVE, colors=256))
    duration_ms = int(1000 / fps)
    pil_frames[0].save(
        output_path, save_all=True, append_images=pil_frames[1:],
        loop=0, duration=duration_ms, optimize=False
    )

def frames_to_mp4(frames: list[np.ndarray], labels: list[str],
                  output_path: str, fps: int = 4, resize_width: int = 900):
    if not frames:
        return
    h0, w0 = frames[0].shape[:2]
    scale = resize_width / w0
    out_w = resize_width
    out_h = int(h0 * scale)
    # H.264 requires even dimensions
    out_w += out_w % 2
    out_h += out_h % 2

    # avc1 (H.264) is hardware-accelerated on macOS and avoids the green-
    # pixel bug that mp4v produces on Apple Silicon / newer macOS builds.
    # Fall back through codecs until one opens successfully.
    out = None
    for codec in (['avc1'] if sys.platform == 'darwin' else []) + ['mp4v', 'XVID']:
        fourcc = cv2.VideoWriter_fourcc(*codec)
        writer = cv2.VideoWriter(output_path, fourcc, float(fps), (out_w, out_h))
        if writer.isOpened():
            out = writer
            print(f"  [video] using codec={codec} {out_w}×{out_h} @ {fps}fps",
                  flush=True)
            break
        writer.release()

    if out is None:
        raise RuntimeError("Could not open VideoWriter with any available codec.")

    try:
        for img, label in zip(frames, labels):
            pil_img = (Image.fromarray(img)
                       .resize((out_w, out_h), Image.LANCZOS)
                       .convert("RGBA"))
            pil_img = add_timestamp(pil_img, label)
            rgb = np.array(pil_img.convert("RGB"), dtype=np.uint8)
            bgr = np.ascontiguousarray(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
            if bgr.shape[:2] != (out_h, out_w):
                bgr = cv2.resize(bgr, (out_w, out_h))
            out.write(bgr)
    finally:
        out.release()

# ──────────────────────────────────────────────
# JOB STATE  (in-memory, single-user)
# ──────────────────────────────────────────────

class JobState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.status     = "idle"   # idle | running | done | error
        self.progress   = 0
        self.total      = 0
        self.message    = ""
        self.result     = None     # path or b64 preview

JOB = JobState()
CHANGE_JOB = JobState()
OUTPUT_DIR = Path("/tmp/river_timelapse_output")
OUTPUT_DIR.mkdir(exist_ok=True)

MOMENTS_DIR = OUTPUT_DIR / "moments"
MOMENTS_DIR.mkdir(exist_ok=True)


# ──────────────────────────────────────────────
# MOMENTS  —  bookmarks inside a generated timelapse
# ──────────────────────────────────────────────

def _moments_file(video_path: str) -> Path:
    """JSON file that stores all bookmarks for a given output video."""
    return MOMENTS_DIR / (Path(video_path).stem + ".json")

def load_moments(video_path: str) -> list[dict]:
    f = _moments_file(video_path)
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text())
    except Exception:
        return []

def save_moments(video_path: str, moments: list[dict]) -> None:
    _moments_file(video_path).write_text(json.dumps(moments, indent=2))

def add_moment(video_path: str, time_sec: float, label: str,
               note: str, thumb_b64: str) -> dict:
    moments = load_moments(video_path)
    m = {
        "id":         f"m_{int(time.time()*1000)}_{len(moments)}",
        "time":       float(time_sec),
        "label":      label or "",
        "note":       note or "",
        "thumb":      thumb_b64 or "",
        "created_at": int(time.time()),
    }
    moments.append(m)
    moments.sort(key=lambda x: x["time"])
    save_moments(video_path, moments)
    return m

def delete_moment(video_path: str, moment_id: str) -> bool:
    moments = load_moments(video_path)
    new = [m for m in moments if m["id"] != moment_id]
    if len(new) == len(moments):
        return False
    save_moments(video_path, new)
    return True

# ──────────────────────────────────────────────
# PROCESSING TASKS
# ──────────────────────────────────────────────

def natural_sort_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

def gather_images(folder: str) -> list[str]:
    exts = ('*.jpg','*.jpeg','*.png','*.tif','*.tiff','*.bmp')
    files = []
    for ext in exts:
        files.extend(glob.glob(os.path.join(folder, ext)))
        files.extend(glob.glob(os.path.join(folder, ext.upper())))
    return sorted(set(files), key=natural_sort_key)

def filter_by_time(paths: list[str],
                   time_slots: list[str],
                   tolerance_min: int = 45) -> list[str]:
    """
    Temporal sub-sampling: keep at most one image per (calendar-date, time-slot).

    For each day in the dataset, and for each requested time slot (e.g. '08:00'),
    this picks the image whose shot time is closest to that target, provided it
    falls within `tolerance_min` minutes.  The result is sorted chronologically.

    time_slots  : list of 'HH:MM' strings, e.g. ['08:00', '14:00', '18:00']
    tolerance_min: maximum deviation from the target time (minutes)
    """
    if not time_slots:
        return paths

    # Parse target times as timedeltas from midnight
    targets: list[_td] = []
    for slot in time_slots:
        try:
            h, m = map(int, slot.strip().split(':'))
            targets.append(_td(hours=h, minutes=m))
        except Exception:
            pass
    if not targets:
        return paths

    tolerance = _td(minutes=max(1, tolerance_min))

    # Read EXIF datetime for every image; skip images with no timestamp
    dated: list[tuple[str, _dt]] = []
    for p in paths:
        raw = read_exif_datetime(p)
        if raw:
            try:
                dated.append((p, _dt.strptime(raw, '%Y:%m:%d %H:%M:%S')))
            except Exception:
                pass

    if not dated:
        print("  [timefilter] no EXIF datetimes found — returning all images",
              flush=True)
        return paths

    # Group by calendar date
    by_date: dict = _defaultdict(list)
    for p, dt in dated:
        by_date[dt.date()].append((p, dt))

    selected: dict = {}   # (date, target_td) → path
    for date, items in sorted(by_date.items()):
        for tgt in targets:
            best_path, best_delta = None, None
            for p, dt in items:
                shot_td = _td(hours=dt.hour, minutes=dt.minute, seconds=dt.second)
                delta = abs(shot_td - tgt)
                # Handle midnight wrap (e.g. 23:50 vs 00:10)
                delta = min(delta, _td(hours=24) - delta)
                if delta <= tolerance:
                    if best_delta is None or delta < best_delta:
                        best_delta, best_path = delta, p
            if best_path:
                selected[(date, tgt)] = best_path

    result = [selected[k] for k in sorted(selected)]
    print(f"  [timefilter] {len(dated)} images → {len(result)} selected "
          f"({len(targets)} slot(s)/day, ±{tolerance_min} min)", flush=True)
    return result


def run_job(folder: str, mode: str, rois: list, output_format: str, fps: int,
            use_ecc: bool = False,
            time_slots: list | None = None,
            tolerance_min: int = 45,
            crop_view: bool = False):
    global JOB
    JOB.status = "running"; JOB.progress = 0; JOB.result = None

    def progress(i, total, msg=""):
        JOB.progress = i; JOB.total = total; JOB.message = msg

    try:
        all_paths = gather_images(folder)
        if not all_paths:
            raise ValueError("No images found in the selected folder.")

        # ── time-based sub-sampling (timefilter mode) ──────────────────
        if mode == "timefilter" and time_slots:
            JOB.message = f"Found {len(all_paths)} images. Filtering by time…"
            paths = filter_by_time(all_paths, time_slots, tolerance_min)
            if not paths:
                raise ValueError(
                    "No images matched the requested time slots. "
                    "Try increasing the tolerance or adjusting the times.")
            JOB.message = (f"{len(paths)} images selected from "
                           f"{len(all_paths)} total. Starting alignment…")
        else:
            paths = all_paths

        JOB.total = len(paths)

        # ── choose alignment ROI mask ───────────────────────────────────
        if mode == "general":
            alignment_rois = None
        elif mode in ("select", "custom", "timefilter"):
            alignment_rois = rois if rois else None
        else:
            alignment_rois = None

        aligned = align_images(paths, alignment_rois, progress_cb=progress,
                               use_ecc=use_ecc)

        # ── crop output window ──────────────────────────────────────────
        # select mode always crops; timefilter crops only if crop_view=True
        do_crop = (mode == "select" or
                   (mode == "timefilter" and crop_view)) and bool(rois)
        if do_crop:
            aligned = crop_to_roi(aligned, rois[0])

        labels = make_labels(paths)

        # ── export ──
        progress(len(paths), len(paths), "Rendering timelapse…")
        out_name = f"timelapse_{mode}_{int(time.time())}"
        if output_format == "gif":
            out_path = str(OUTPUT_DIR / f"{out_name}.gif")
            frames_to_gif(aligned, labels, out_path, fps=fps)
        else:
            out_path = str(OUTPUT_DIR / f"{out_name}.mp4")
            frames_to_mp4(aligned, labels, out_path, fps=fps)

        # also make a small preview gif for the browser
        preview_path = str(OUTPUT_DIR / f"{out_name}_preview.gif")
        frames_to_gif(aligned, labels, preview_path, fps=fps, resize_width=640)

        JOB.result = {
            "file":    out_path,
            "preview": preview_path,
            "count":   len(aligned),
            "fps":     fps,
            "labels":  labels,
        }
        JOB.status = "done"
        JOB.message = "Done!"

    except Exception as e:
        JOB.status = "error"
        JOB.message = str(e)
        traceback.print_exc()


def analyze_timelapse_changes(
    video_path: str,
    roi_norm: dict,
    sensitivity: float = 2.0,
    min_segment_sec: float = 2.0,
    pad_sec: float = 1.5,
    labels: list | None = None,
    progress_cb=None,
) -> dict:
    """
    Detect intervals where pixels inside an ROI change unusually compared to
    neighbouring frames (after Gaussian smoothing on a normalized difference).

    roi_norm: {x,y,w,h} in 0–1 relative to full frame (same convention as alignment ROIs).
    Higher `sensitivity` → more regions flagged (lower adaptive threshold).
    """
    if not os.path.exists(video_path):
        raise ValueError("Video file not found")

    x = float(roi_norm.get("x", 0))
    y = float(roi_norm.get("y", 0))
    w = float(roi_norm.get("w", 1))
    h = float(roi_norm.get("h", 1))
    if w <= 0 or h <= 0:
        raise ValueError("Invalid ROI dimensions")
    if x + w > 1.001 or y + h > 1.001:
        raise ValueError("ROI extends outside the frame")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Cannot open video")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = (n_frames / fps) if fps > 0 else 0.0

    x1 = int(x * W)
    y1 = int(y * H)
    x2 = int((x + w) * W)
    y2 = int((y + h) * H)
    x1 = max(0, min(W - 1, x1))
    x2 = max(x1 + 1, min(W, x2))
    y1 = max(0, min(H - 1, y1))
    y2 = max(y1 + 1, min(H, y2))
    if (x2 - x1) * (y2 - y1) < 400:
        raise ValueError("ROI too small — draw a larger region")

    step = max(1, n_frames // 2500)

    scores_idx: list[int] = []
    raw_scores: list[float] = []
    prev_gray = None
    frame_idx = 0
    processed_count = 0

    if progress_cb:
        progress_cb(0, max(n_frames, 1), "Scanning video…")

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step != 0:
            frame_idx += 1
            continue

        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            frame_idx += 1
            continue
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        tw = min(320, gray.shape[1])
        scale = tw / gray.shape[1]
        th = max(8, int(gray.shape[0] * scale))
        gray = cv2.resize(gray, (tw, th), interpolation=cv2.INTER_AREA)

        if prev_gray is not None:
            diff = cv2.absdiff(gray, prev_gray)
            mad = float(np.mean(diff))
            norm = float(np.mean(gray)) + 1e-6
            score = (mad / norm) * 100.0
            scores_idx.append(frame_idx)
            raw_scores.append(score)

        prev_gray = gray
        processed_count += 1

        if progress_cb and processed_count % 25 == 0:
            progress_cb(min(frame_idx + 1, n_frames), max(n_frames, 1),
                        f"Scanning… frame {frame_idx}/{n_frames}")

        frame_idx += 1

    cap.release()

    if len(raw_scores) < 4:
        return {
            "segments": [],
            "scores_curve": [],
            "fps": fps,
            "duration": round(duration, 3),
            "threshold": 0.0,
            "frame_count": n_frames,
        }

    idxs = np.array(scores_idx, dtype=np.float64)
    raw = np.array(raw_scores, dtype=np.float64)

    win = min(7, len(raw) // 2 * 2 + 1)
    if win < 3:
        win = 3
    if win % 2 == 0:
        win -= 1
    kernel = np.ones(win) / win
    pad = win // 2
    padded = np.pad(raw, (pad, pad), mode="edge")
    smooth = np.convolve(padded, kernel, mode="valid")

    p70 = np.percentile(smooth, 70)
    p95 = np.percentile(smooth, 95)
    span = max(p95 - p70, 1e-9)
    sens = max(0.5, float(sensitivity))
    thresh = p70 + span * (2.0 / sens)

    above = smooth > thresh

    segments_out: list[dict] = []
    i = 0
    n = len(above)
    while i < n:
        if not above[i]:
            i += 1
            continue
        j = i
        while j < n and above[j]:
            j += 1
        seg_smooth = smooth[i:j]
        peak_rel = int(np.argmax(seg_smooth))
        peak_i = i + peak_rel
        seg_start_f = int(idxs[i])
        seg_end_f = int(idxs[j - 1])
        peak_frame = int(idxs[peak_i])
        peak_score = float(smooth[peak_i])

        dur_sec = (seg_end_f - seg_start_f) / fps if fps > 0 else 0.0
        if dur_sec < min_segment_sec:
            i = j
            continue

        t_start = max(0.0, seg_start_f / fps - pad_sec)
        t_end = min(duration, seg_end_f / fps + pad_sec)
        t_peak = peak_frame / fps if fps > 0 else 0.0

        label_at_peak = ""
        if labels and len(labels) > 0 and n_frames > 0:
            li = int(round((peak_frame / max(n_frames - 1, 1)) * (len(labels) - 1)))
            li = max(0, min(len(labels) - 1, li))
            raw_lb = labels[li]
            if isinstance(raw_lb, str):
                label_at_peak = raw_lb.replace("|", "  ")

        segments_out.append({
            "start": round(t_start, 3),
            "end": round(t_end, 3),
            "peak": round(t_peak, 3),
            "peak_score": round(peak_score, 4),
            "label_at_peak": label_at_peak,
        })

        i = j

    curve: list[dict] = []
    n_pts = min(400, len(smooth))
    if n_pts >= 2:
        pick = np.linspace(0, len(smooth) - 1, n_pts).astype(int)
        for pi in pick:
            curve.append({
                "t": float(idxs[pi]) / fps if fps > 0 else 0.0,
                "v": float(smooth[pi]),
            })

    return {
        "segments": segments_out,
        "scores_curve": curve,
        "fps": fps,
        "duration": round(duration, 3),
        "threshold": round(float(thresh), 6),
        "frame_count": n_frames,
    }


def run_change_detection(
    video_path: str,
    roi_norm: dict,
    sensitivity: float = 2.0,
    min_segment_sec: float = 2.0,
    pad_sec: float = 1.5,
    labels: list | None = None,
):
    global CHANGE_JOB
    CHANGE_JOB.status = "running"
    CHANGE_JOB.progress = 0
    CHANGE_JOB.total = 100
    CHANGE_JOB.message = "Starting…"
    CHANGE_JOB.result = None

    def progress(cur, tot, msg):
        CHANGE_JOB.progress = cur
        CHANGE_JOB.total = tot
        CHANGE_JOB.message = msg

    try:
        result = analyze_timelapse_changes(
            video_path,
            roi_norm,
            sensitivity=sensitivity,
            min_segment_sec=min_segment_sec,
            pad_sec=pad_sec,
            labels=labels,
            progress_cb=progress,
        )
        CHANGE_JOB.result = result
        CHANGE_JOB.status = "done"
        CHANGE_JOB.message = "Analysis complete"
        CHANGE_JOB.progress = CHANGE_JOB.total
    except Exception as e:
        CHANGE_JOB.status = "error"
        CHANGE_JOB.message = str(e)
        traceback.print_exc()


# ──────────────────────────────────────────────
# HTTP SERVER
# ──────────────────────────────────────────────

# Path to the HTML front-end, next to this script
APP_DIR = Path(__file__).parent
HTML_FILE = APP_DIR / "index.html"
STYLES_DIR = APP_DIR / "styles"

_HTML_FALLBACK = b"<h1>index.html not found next to aligner.py</h1>"
# The rest of the old inline HTML has been moved to index.html.
# ──────────────────────────────────────────────
# REQUEST HANDLER
# ──────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence default logs

    def send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin","*")
        self.end_headers()
        self.wfile.write(body)

    def _write_body_safe(self, data: bytes) -> None:
        """Client closed socket (seek / navigation / cancel) — ignore."""
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_file(self, path):
        with open(path, 'rb') as f:
            data = f.read()
        ext = Path(path).suffix.lower()
        ct = {'.mp4':'video/mp4','.gif':'image/gif',
              '.jpg':'image/jpeg','.png':'image/png'}.get(ext,'application/octet-stream')
        self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", len(data))
        self.send_header("Content-Disposition",
                         f'attachment; filename="{Path(path).name}"')
        self.end_headers()
        self.wfile.write(data)

    def stream_file(self, path):
        """
        Serve a file with HTTP Range request support so that the browser's
        <video> element can seek freely without downloading the whole file.
        """
        ext = Path(path).suffix.lower()
        ct  = {'.mp4':'video/mp4','.gif':'image/gif'}.get(ext,'application/octet-stream')
        file_size = os.path.getsize(path)

        range_header = self.headers.get('Range', '')
        if range_header.startswith('bytes='):
            parts = range_header[6:].split('-')
            start = int(parts[0]) if parts[0] else 0
            end   = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
            end   = min(end, file_size - 1)
            length = end - start + 1
            self.send_response(206)
            self.send_header('Content-Type',  ct)
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
            self.send_header('Content-Length', length)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            with open(path, 'rb') as f:
                f.seek(start)
                self._write_body_safe(f.read(length))
        else:
            self.send_response(200)
            self.send_header('Content-Type',   ct)
            self.send_header('Content-Length', file_size)
            self.send_header('Accept-Ranges',  'bytes')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            with open(path, 'rb') as f:
                self._write_body_safe(f.read())

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/":
            try:
                body = HTML_FILE.read_bytes()
            except FileNotFoundError:
                body = _HTML_FALLBACK
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)

        elif parsed.path == "/api/preview":
            folder = qs.get('folder',[''])[0]
            paths = gather_images(folder)
            if not paths:
                return self.send_json({"error":"No images found in that folder."})
            # encode first image as JPEG b64
            img = load_image_bgr(paths[0])
            h,w = img.shape[:2]
            scale = 900/max(w,1)
            if scale < 1:
                img = cv2.resize(img, (int(w*scale), int(h*scale)))
            _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 80])
            b64 = base64.b64encode(buf.tobytes()).decode()
            self.send_json({"image_b64": b64, "count": len(paths)})

        elif parsed.path == "/api/status":
            self.send_json({"status":JOB.status,"progress":JOB.progress,
                            "total":JOB.total,"message":JOB.message,"result":JOB.result})

        elif parsed.path == "/api/change_status":
            self.send_json({"status": CHANGE_JOB.status, "progress": CHANGE_JOB.progress,
                            "total": CHANGE_JOB.total, "message": CHANGE_JOB.message,
                            "result": CHANGE_JOB.result})

        elif parsed.path == "/api/preview_result":
            path = qs.get('path',[''])[0]
            if not os.path.exists(path):
                return self.send_json({"error":"File not found"})
            with open(path,'rb') as f:
                b64 = base64.b64encode(f.read()).decode()
            self.send_json({"b64": b64})

        elif parsed.path == "/api/download":
            path = qs.get('path', [''])[0]
            if not os.path.exists(path):
                self.send_response(404); self.end_headers(); return
            self.send_file(path)

        elif parsed.path == "/api/stream":
            path = qs.get('path', [''])[0]
            if not os.path.exists(path):
                self.send_response(404); self.end_headers(); return
            self.stream_file(path)

        elif parsed.path == "/api/moments/list":
            video = qs.get('video', [''])[0]
            if not video:
                return self.send_json({"error": "missing video"})
            self.send_json({"moments": load_moments(video)})

        elif parsed.path.startswith("/styles/"):
            rel = parsed.path[len("/styles/"):]
            if not rel or ".." in rel or rel.startswith("/"):
                self.send_response(404); self.end_headers(); return
            style_path = (STYLES_DIR / rel).resolve()
            try:
                style_path.relative_to(STYLES_DIR.resolve())
            except ValueError:
                self.send_response(404); self.end_headers(); return
            if not style_path.is_file():
                self.send_response(404); self.end_headers(); return
            with open(style_path, "rb") as f:
                data = f.read()
            ct = "text/css" if style_path.suffix.lower() == ".css" else "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", len(data))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)

        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path == "/api/run":
            length = int(self.headers.get('Content-Length',0))
            body = json.loads(self.rfile.read(length))
            t = threading.Thread(target=run_job, kwargs={
                "folder":        body.get('folder', ''),
                "mode":          body.get('mode', 'general'),
                "rois":          body.get('rois', []),
                "output_format": body.get('format', 'mp4'),
                "fps":           body.get('fps', 4),
                "use_ecc":       body.get('use_ecc', False),
                "time_slots":    body.get('time_slots', []),
                "tolerance_min": int(body.get('tolerance_min', 45)),
                "crop_view":     bool(body.get('crop_view', False)),
            }, daemon=True)
            t.start()
            self.send_json({"ok": True})

        elif self.path == "/api/moments/add":
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            video = body.get('video', '')
            if not video:
                return self.send_json({"error": "missing video"})
            m = add_moment(
                video_path=video,
                time_sec=float(body.get('time', 0)),
                label=body.get('label', ''),
                note=body.get('note', ''),
                thumb_b64=body.get('thumb', ''),
            )
            self.send_json({"ok": True, "moment": m})

        elif self.path == "/api/moments/delete":
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            ok = delete_moment(body.get('video', ''), body.get('id', ''))
            self.send_json({"ok": bool(ok)})

        elif self.path == "/api/change_detect":
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            video = body.get('video', '')
            roi = body.get('roi')
            if not video or not roi:
                return self.send_json({"error": "missing video or roi"})
            if CHANGE_JOB.status == "running":
                return self.send_json({"error": "Analysis already running"})
            t = threading.Thread(target=run_change_detection, kwargs={
                "video_path":       video,
                "roi_norm":         roi,
                "sensitivity":      float(body.get('sensitivity', 2.0)),
                "min_segment_sec":  float(body.get('min_segment_sec', 2.0)),
                "pad_sec":          float(body.get('pad_sec', 1.5)),
                "labels":           body.get('labels'),
            }, daemon=True)
            t.start()
            self.send_json({"ok": True})

        else:
            self.send_response(404); self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Methods","GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.end_headers()

# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "3000"))

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"""
Yukon Aligner
Open in browser: http://localhost:{PORT}
Press Ctrl+C to stop.
""")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")