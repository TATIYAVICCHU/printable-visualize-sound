"""Build the one real physical-experiment test page: print this, photograph or
scan it back, hand the photo back for decoding.

Chooses hsv scheme, speech clip (the real recorded voice sample), block size 4
because that sits right at the crossover this project's simulation found —
the most informative point to test physically, since the simulated result is
least certain there. Each spectrogram bin becomes a 4x4 pixel block, and black
corner markers are added purely as a visual aid for framing the photo
squarely; nothing in the code auto-detects them.
"""

import json
import pathlib
import sys

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
MARGIN = 60
MARKER = 28


def main():
    OUT_DIR.mkdir(exist_ok=True)
    x, sr = sf.read(ROOT / "samples" / f"{CLIP}.wav")
    if x.ndim > 1:
        x = x.mean(axis=1)

    img, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, scheme=SCHEME)
    meta["block"] = BLOCK
    meta["clip"] = CLIP

    blocked = np.repeat(np.repeat(img, BLOCK, axis=0), BLOCK, axis=1)
    h, w = blocked.shape[:2]

    canvas_w, canvas_h = w + 2 * MARGIN, h + 2 * MARGIN
    page = Image.new("RGB", (canvas_w, canvas_h), "white")
    page.paste(Image.fromarray(blocked), (MARGIN, MARGIN))

    draw = ImageDraw.Draw(page)
    corners = [
        (MARGIN, MARGIN),
        (canvas_w - MARGIN, MARGIN),
        (MARGIN, canvas_h - MARGIN),
        (canvas_w - MARGIN, canvas_h - MARGIN),
    ]
    for cx, cy in corners:
        draw.rectangle([cx - MARKER, cy - MARKER, cx, cy], fill="black")

    caption = (f"visualize-sound print target  |  clip={CLIP}  scheme={SCHEME}  "
               f"block={BLOCK}x{BLOCK}  code area {w}x{h}px")
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    draw.text((MARGIN, canvas_h - MARGIN + 6), caption, fill="black", font=font)

    png_path = OUT_DIR / "print_target.png"
    json_path = OUT_DIR / "print_target.json"
    page.save(png_path)
    with open(json_path, "w") as f:
        json.dump({
            "meta": meta,
            "code_area_px": [w, h],
            "margin_px": MARGIN,
            "marker_px": MARKER,
        }, f, indent=2)

    print(f"code area: {w}x{h}px  (block={BLOCK}x{BLOCK})")
    print(f"full page: {canvas_w}x{canvas_h}px")
    print(f"wrote {png_path}")
    print(f"wrote {json_path}")


if __name__ == "__main__":
    main()
