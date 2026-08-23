"""Build the one real physical-experiment test page: print this, photograph or
scan it back, hand the photo back for decoding.

Chooses hsv scheme, speech clip (the real recorded voice sample), block size 4
because that sits right at the crossover this project's simulation found —
the most informative point to test physically, since the simulated result is
least certain there.

Four ArUco markers (cv2.aruco, DICT_ARUCO_ORIGINAL, ids 0-3) sit at the corners.
This is the same technique used across robotics/AR for exactly this problem
-- finding a printed rectangle's position, rotation, and scale in an
arbitrary photo -- rather than assuming the page is framed square-on. IDs
are ordered clockwise from top-left (0=TL, 1=TR, 2=BR, 3=BL) so a detector
can recover orientation, not just position. decode_scan.py detects these
automatically and perspective-corrects before decoding; no manual cropping
needed.
"""

import json
import pathlib
import sys

import cv2
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import codec

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "artifacts"

CLIP = "speech"
SCHEME = "hsv"
N_FFT = 1024
HOP = 256
BLOCK = 4

MARKER_PX = 140
MARKER_MARGIN = 40   # gap between a marker and the code area
PAGE_MARGIN = 40      # gap between markers and the page edge
# ARUCO_ORIGINAL, not a 4x4 dict: the web app's in-browser detector (js-aruco2)
# ports its 'ARUCO_DEFAULT_OPENCV' dictionary directly from this one -- bit for
# bit -- so markers generated here are also detectable client-side, with no
# server round trip, using the same fiducial-marker technique either way.
ARUCO_DICT_NAME = "DICT_ARUCO_ORIGINAL"
ARUCO_DICT = cv2.aruco.DICT_ARUCO_ORIGINAL


def make_marker(marker_id: int, size: int) -> Image.Image:
    arr = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(ARUCO_DICT), marker_id, size)
    return Image.fromarray(arr).convert("RGB")


def main():
    OUT_DIR.mkdir(exist_ok=True)
    x, sr = sf.read(ROOT / "samples" / f"{CLIP}.wav")
    if x.ndim > 1:
        x = x.mean(axis=1)

    img, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, scheme=SCHEME)
    meta["block"] = BLOCK
    meta["clip"] = CLIP

    blocked = np.repeat(np.repeat(img, BLOCK, axis=0), BLOCK, axis=1)
    code_h, code_w = blocked.shape[:2]

    code_x0 = PAGE_MARGIN + MARKER_PX + MARKER_MARGIN
    code_y0 = PAGE_MARGIN + MARKER_PX + MARKER_MARGIN
    canvas_w = code_x0 + code_w + MARKER_MARGIN + MARKER_PX + PAGE_MARGIN
    canvas_h = code_y0 + code_h + MARKER_MARGIN + MARKER_PX + PAGE_MARGIN

    page = Image.new("RGB", (canvas_w, canvas_h), "white")
    page.paste(Image.fromarray(blocked), (code_x0, code_y0))

    # id 0=TL, 1=TR, 2=BR, 3=BL -- clockwise, so a detector recovers orientation.
    marker_positions = {
        0: (PAGE_MARGIN, PAGE_MARGIN),
        1: (canvas_w - PAGE_MARGIN - MARKER_PX, PAGE_MARGIN),
        2: (canvas_w - PAGE_MARGIN - MARKER_PX, canvas_h - PAGE_MARGIN - MARKER_PX),
        3: (PAGE_MARGIN, canvas_h - PAGE_MARGIN - MARKER_PX),
    }
    for marker_id, (mx, my) in marker_positions.items():
        page.paste(make_marker(marker_id, MARKER_PX), (mx, my))

    draw = ImageDraw.Draw(page)
    caption = (f"visualize-sound print target  |  clip={CLIP}  scheme={SCHEME}  "
               f"block={BLOCK}x{BLOCK}  code area {code_w}x{code_h}px  |  "
               f"ArUco DICT_ARUCO_ORIGINAL ids 0-3, clockwise from top-left")
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    draw.text((PAGE_MARGIN, canvas_h - PAGE_MARGIN + 8), caption, fill="black", font=font)

    # The four corners of the code area itself (not the markers), in page
    # pixel coordinates -- where the decoded blocks actually live.
    code_corners = {
        "top_left": [code_x0, code_y0],
        "top_right": [code_x0 + code_w, code_y0],
        "bottom_right": [code_x0 + code_w, code_y0 + code_h],
        "bottom_left": [code_x0, code_y0 + code_h],
    }
    # The markers' own centers, in the same page pixel coordinates. The
    # homography must be estimated from marker-center-to-marker-center
    # correspondences (the same physical points in both photo and page
    # space) -- not from marker centers to code corners, which are
    # different points offset by the margin between them.
    marker_centers = {
        marker_id: [mx + MARKER_PX / 2, my + MARKER_PX / 2]
        for marker_id, (mx, my) in marker_positions.items()
    }

    png_path = OUT_DIR / "print_target.png"
    json_path = OUT_DIR / "print_target.json"
    page.save(png_path)
    with open(json_path, "w") as f:
        json.dump({
            "meta": meta,
            "code_area_px": [code_w, code_h],
            "code_corners_px": code_corners,
            "marker_centers_px": marker_centers,
            "aruco_dict": ARUCO_DICT_NAME,
            "marker_ids_clockwise_from_top_left": [0, 1, 2, 3],
            "marker_px": MARKER_PX,
        }, f, indent=2)

    print(f"code area: {code_w}x{code_h}px  (block={BLOCK}x{BLOCK})")
    print(f"full page: {canvas_w}x{canvas_h}px, ArUco markers 0-3 at corners")
    print(f"wrote {png_path}")
    print(f"wrote {json_path}")


if __name__ == "__main__":
    main()
