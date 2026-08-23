"""Decode a real photo of a printed page from scripts/make_print_target.py.

Usage: .venv/bin/python scripts/decode_scan.py path/to/photo.jpg [--json artifacts/print_target.json]

Unlike the first version of this script, the photo does NOT need to be
pre-cropped or square-on. Four ArUco markers (cv2.aruco, DICT_4X4_50, ids
0-3, clockwise from top-left) are detected automatically in the photo --
the same technique AR/robotics applications use to locate a printed target
at an unknown position, rotation, scale, and viewing angle. Their detected
centers, paired with those same markers' known centers on the page, give a
homography from photo pixels to page pixels. Each spectrogram bin is then
read with a single bilinear sample at its known page location, mapped back
into the photo through that homography -- not by warping the whole photo
and then averaging an integer pixel grid over it, which turned out to
compound enough rounding error to corrupt the hue-encoded phase even on a
distortion-free re-photograph. Photograph the whole page, any reasonable
angle, any distance -- just keep all four markers visible.
"""

import argparse
import json
import pathlib
import sys

import cv2
import numpy as np
import soundfile as sf
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import codec, metrics

ROOT = pathlib.Path(__file__).resolve().parent.parent


def sample_blocks_via_homography(photo_bgr: np.ndarray, H_photo_to_known: np.ndarray,
                                  code_x0: int, code_y0: int, code_w: int, code_h: int,
                                  block: int) -> np.ndarray:
    """Read one color per spectrogram bin straight out of the photo.

    Warping the whole photo into the known layout and then averaging each
    block on an integer pixel grid compounds two roundings: the warp's own
    resampling, and the block grid landing a few pixels off true block
    boundaries after that warp (marker corners are never pixel-exact, and a
    homography is only piecewise-exact in general). Since hue encodes phase
    and wraps circularly, averaging across a block boundary blends two
    unrelated phase values into noise -- which is why even a distortion-free
    synthetic re-photograph decoded to garbage.

    Sampling each block's known center exactly once, straight from the
    original photo via the inverse homography, removes the second rounding
    entirely: one bilinear sample per bin, at the coordinate the printer
    actually put it, however the page was rotated or skewed in the photo.
    """
    H_known_to_photo = np.linalg.inv(H_photo_to_known)

    bins_h, bins_w = code_h // block, code_w // block
    ys, xs = np.meshgrid(np.arange(bins_h), np.arange(bins_w), indexing="ij")
    known_x = code_x0 + (xs + 0.5) * block
    known_y = code_y0 + (ys + 0.5) * block

    pts = np.stack([known_x.ravel(), known_y.ravel()], axis=1).astype(np.float64)
    pts_h = np.hstack([pts, np.ones((len(pts), 1))])
    photo_pts = pts_h @ H_known_to_photo.T
    photo_pts = photo_pts[:, :2] / photo_pts[:, 2:3]

    out = cv2.remap(
        photo_bgr,
        photo_pts[:, 0].astype(np.float32).reshape(bins_h, bins_w),
        photo_pts[:, 1].astype(np.float32).reshape(bins_h, bins_w),
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return out


def detect_corners(photo_bgr: np.ndarray, aruco_dict_name: str) -> dict:
    """Return {marker_id: [x, y]} for each detected marker's center."""
    aruco_dict = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, aruco_dict_name))
    detector = cv2.aruco.ArucoDetector(aruco_dict, cv2.aruco.DetectorParameters())
    gray = cv2.cvtColor(photo_bgr, cv2.COLOR_BGR2GRAY)
    corners, ids, _ = detector.detectMarkers(gray)

    if ids is None or len(ids) < 4:
        found = [] if ids is None else ids.flatten().tolist()
        raise RuntimeError(
            f"only found ArUco markers {found}, need all of [0, 1, 2, 3]. "
            "Retake the photo with all four corner markers clearly visible, "
            "good lighting, and the page not too warped/crumpled."
        )

    centers = {}
    for marker_corners, marker_id in zip(corners, ids.flatten()):
        pts = marker_corners.reshape(4, 2)
        centers[int(marker_id)] = pts.mean(axis=0)
    return centers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo", type=pathlib.Path)
    ap.add_argument("--json", type=pathlib.Path, default=ROOT / "artifacts" / "print_target.json")
    ap.add_argument("--reference", type=pathlib.Path, default=ROOT / "samples" / "speech.wav")
    ap.add_argument("--save-debug", action="store_true",
                     help="also save <photo>.rectified.png showing the corrected crop")
    args = ap.parse_args()

    with open(args.json) as f:
        info = json.load(f)
    meta = info["meta"]
    code_w, code_h = info["code_area_px"]
    block = meta["block"]
    corners_known = info["code_corners_px"]
    marker_centers_known = info["marker_centers_px"]

    photo_bgr = cv2.imread(str(args.photo))
    if photo_bgr is None:
        sys.exit(f"could not read {args.photo}")

    detected = detect_corners(photo_bgr, info["aruco_dict"])
    print(f"detected markers: {sorted(detected.keys())}")

    # Correspondences must be the same physical point in both spaces: each
    # marker's own center, detected in the photo, paired with that same
    # marker's known center on the page. (Not the code area's corners --
    # those are different points, offset from the markers by the margin
    # between them, and pairing them here would silently warp everything.)
    src_pts = np.float32([detected[i] for i in range(4)])
    dst_pts = np.float32([marker_centers_known[str(i)] for i in range(4)])

    # Photo -> known page coordinates (used to find each block's true photo location).
    H, _ = cv2.findHomography(src_pts, dst_pts)

    x0, y0 = map(int, corners_known["top_left"])
    shrunk_bgr = sample_blocks_via_homography(photo_bgr, H, x0, y0, code_w, code_h, block)
    shrunk = cv2.cvtColor(shrunk_bgr, cv2.COLOR_BGR2RGB)
    print(f"code area {code_w}x{code_h}px -> {shrunk.shape[1]}x{shrunk.shape[0]} bins "
          f"(sampled directly, no intermediate warp)")

    if args.save_debug:
        debug_path = args.photo.with_suffix(".rectified.png")
        preview = cv2.resize(shrunk, (shrunk.shape[1] * block, shrunk.shape[0] * block),
                             interpolation=cv2.INTER_NEAREST)
        Image.fromarray(preview).save(debug_path)
        print(f"wrote {debug_path}")

    y = codec.decode(shrunk, meta)

    out_wav = args.photo.with_suffix(".decoded.wav")
    sf.write(out_wav, y.astype(np.float32), meta["sr"])
    print(f"wrote {out_wav}")

    if args.reference.exists():
        ref, ref_sr = sf.read(args.reference)
        if ref.ndim > 1:
            ref = ref.mean(axis=1)
        assert ref_sr == meta["sr"]
        m = metrics.evaluate(ref, y, meta["sr"])
        print("\nquality vs. original speech.wav:")
        for k, v in m.items():
            print(f"  {k:8s} {v}")


if __name__ == "__main__":
    main()
