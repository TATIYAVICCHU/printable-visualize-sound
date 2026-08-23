"""Render the encoded images side by side.

This is the motivating figure: what different kinds of sound actually look like
once phase becomes hue, and how much visible structure the grayscale
magnitude-only encoding leaves behind.
"""

import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import codec

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
OUT = ROOT / "out"

N_FFT = 1024
HOP = 256


def main():
    OUT.mkdir(exist_ok=True)
    order = ["chirp", "music", "speech", "environment"]
    clips = [SAMPLES / f"{n}.wav" for n in order]
    clips = [c for c in clips if c.exists()]

    fig, axes = plt.subplots(
        len(clips), 2, figsize=(13, 2.6 * len(clips)),
        gridspec_kw={"hspace": 0.45, "wspace": 0.06},
    )
    fig.patch.set_facecolor("white")

    for row, path in enumerate(clips):
        x, sr = sf.read(path)
        if x.ndim > 1:
            x = x.mean(axis=1)
        duration = len(x) / sr

        for col, scheme in enumerate(("hsv", "gray")):
            img, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, scheme=scheme)
            ax = axes[row, col]
            ax.imshow(img, aspect="auto",
                      extent=[0, duration, 0, sr / 2000.0],
                      interpolation="nearest")
            title = ("phase as hue" if scheme == "hsv"
                     else "magnitude only (grayscale)")
            ax.set_title(f"{path.stem} — {title}", fontsize=10, pad=6)
            ax.set_xlabel("time (s)", fontsize=8)
            if col == 0:
                ax.set_ylabel("kHz", fontsize=8)
            else:
                ax.set_yticklabels([])
            ax.tick_params(labelsize=7)

    fig.suptitle(
        "Sound as image: the same clips under both encodings",
        fontsize=13, y=0.995,
    )
    out = OUT / "gallery.png"
    fig.savefig(out, dpi=150, bbox_inches="tight", facecolor="white")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
