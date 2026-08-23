"""Decode a real photo of a printed page from scripts/make_print_target.py.

Usage: .venv/bin/python scripts/decode_scan.py path/to/photo.jpg [--json artifacts/print_target.json]

The photo must already be cropped to just the code area (the region inside the
four black corner markers, not including them) and roughly square-on — this
script does not do perspective correction. Crop it in any image tool first.
"""

import argparse
import json
import pathlib
import sys

import numpy as np
import soundfile as sf
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import codec, metrics

ROOT = pathlib.Path(__file__).resolve().parent.parent


def shrink_blocks(img: np.ndarray, b: int) -> np.ndarray:
    h, w = (img.shape[0] // b) * b, (img.shape[1] // b) * b
    x = img[:h, :w].astype(np.float64)
    hh, ww = h // b, w // b
    x = x.reshape(hh, b, ww, b, 3)
    if b >= 4:
        trim = b // 4
        x = x[:, trim:b - trim, :, trim:b - trim, :]
    return x.mean(axis=(1, 3)).round().clip(0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo", type=pathlib.Path)
    ap.add_argument("--json", type=pathlib.Path, default=ROOT / "artifacts" / "print_target.json")
    ap.add_argument("--reference", type=pathlib.Path, default=ROOT / "samples" / "speech.wav")
    args = ap.parse_args()

    with open(args.json) as f:
        info = json.load(f)
    meta = info["meta"]
    code_w, code_h = info["code_area_px"]
    block = meta["block"]

    photo = Image.open(args.photo).convert("RGB")
    if photo.size != (code_w, code_h):
        print(f"resizing captured photo {photo.size} -> {(code_w, code_h)} "
              f"(crop it to the code area yourself for a fairer test)")
        photo = photo.resize((code_w, code_h), Image.LANCZOS)

    arr = np.array(photo)
    shrunk = shrink_blocks(arr, block)
    print(f"code area {arr.shape[1]}x{arr.shape[0]}px -> {shrunk.shape[1]}x{shrunk.shape[0]} bins")

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
