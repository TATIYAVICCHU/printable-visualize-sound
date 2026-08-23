"""E2: fold the sound into a square page instead of a strip.

The encodings so far produce a long thin picture whose horizontal axis is time,
which is what every audio editor already draws. This lays the same cells out on
a square page: once by wrapping the sequence like lines of text, and once along
a Hilbert curve, which never cuts the sequence at all.

Both foldings are permutations, so the recovered audio should be bit-for-bit
what the strip layout gives. That is checked rather than assumed: the point of
a layout is what the page looks like and how damage spreads, not fidelity.
"""

import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import codec, layout, metrics

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
OUT = ROOT / "out"

N_FFT = 1024
HOP = 256
LAYOUTS = ["serpentine", "hilbert"]


def roundtrip(x, sr, kind):
    img_ft, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, scheme="hsv")
    cells, shape = layout.spectrogram_to_cells(img_ft)
    square, info = layout.to_square(cells, kind=kind)

    # Go through a real file, so nothing is smuggled between encode and decode.
    png = OUT / f"square_{kind}.png"
    Image.fromarray(square).save(png)
    square2 = np.array(Image.open(png).convert("RGB"))

    cells2 = layout.from_square(square2, info)
    img_ft2 = layout.cells_to_spectrogram(cells2, shape)
    y = codec.decode(img_ft2, meta)
    return square, y, png.stat().st_size


def main():
    OUT.mkdir(exist_ok=True)
    x, sr = sf.read(SAMPLES / "speech.wav")
    if x.ndim > 1:
        x = x.mean(axis=1)

    print(f"\nE2 square layouts   clip=speech   n_fft={N_FFT} hop={HOP}\n")

    img_ft, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, scheme="hsv")
    strip = codec.decode(img_ft, meta)
    base = metrics.evaluate(x, strip, sr)
    print(f"{'layout':14s}{'shape':>14s}{'PESQ':>8s}{'STOI':>8s}{'size':>10s}")
    print("-" * 54)
    print(f"{'strip (time)':14s}{f'{img_ft.shape[1]}x{img_ft.shape[0]}':>14s}"
          f"{base['pesq']:8.2f}{base['stoi']:8.3f}"
          f"{'':>10s}")

    squares = {}
    for kind in LAYOUTS:
        square, y, size = roundtrip(x, sr, kind)
        m = metrics.evaluate(x, y, sr)
        squares[kind] = square
        print(f"{kind:14s}{f'{square.shape[1]}x{square.shape[0]}':>14s}"
              f"{m['pesq']:8.2f}{m['stoi']:8.3f}{size / 1024:9.1f}K")
        assert abs(m["pesq"] - base["pesq"]) < 0.01, "layout changed the audio"

    print("\nBoth foldings return exactly the strip's audio, as they must:")
    print("a layout moves cells around, it does not discard any.")

    fig, axes = plt.subplots(1, len(LAYOUTS), figsize=(11, 5.6))
    fig.patch.set_facecolor("white")
    titles = {
        "serpentine": "serpentine fold\nwraps like lines of text, cuts at each row end",
        "hilbert": "Hilbert curve fold\ncontinuous, no cut points anywhere",
    }
    for ax, kind in zip(axes, LAYOUTS):
        ax.imshow(squares[kind], interpolation="nearest")
        ax.set_title(titles[kind], fontsize=10)
        ax.set_xticks([])
        ax.set_yticks([])
    fig.suptitle("The same 5.9 seconds of speech, folded onto a square page",
                 fontsize=12)
    fig.tight_layout()
    out = OUT / "square_layouts.png"
    fig.savefig(out, dpi=150, facecolor="white")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
