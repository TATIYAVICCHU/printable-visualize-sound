"""E1-blocks: does giving each value more paper save the phase?

The first channel experiment printed one spectrogram bin per pixel, which is
the most fragile arrangement available: ink spread and chroma loss act at the
scale of a pixel, so a one-pixel value has nothing to spare. Barcodes solve the
same problem by making each cell several pixels across.

Here each bin becomes a B by B block. The channel damage is held fixed in pixel
units, so a larger block means the damage is small relative to a cell. The cost
is capacity: a page holds B squared times less audio.
"""

import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import channel, codec, metrics

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
OUT = ROOT / "out"

N_FFT = 1024
HOP = 256
GAMMA = 1.15
DAMAGE = dict(blur=0.8, chroma=2, gamma=GAMMA, noise=0.01)
BLOCKS = [1, 2, 4, 8]
SCHEMES = [("hsv", dict(scheme="hsv")),
           ("ifreq/8", dict(scheme="ifreq", anchor=8)),
           ("gray", dict(scheme="gray"))]


def expand(img, b):
    return np.repeat(np.repeat(img, b, axis=0), b, axis=1)


def shrink(img, b):
    """Average each block back down to one value, discarding the block edges.

    The outer ring of every block is where ink from neighbouring cells has
    bled in, so the average is taken over the interior when there is one.
    """
    h, w = img.shape[0] // b, img.shape[1] // b
    x = img[:h * b, :w * b].astype(np.float64).reshape(h, b, w, b, 3)
    if b >= 4:
        trim = b // 4
        x = x[:, trim:b - trim, :, trim:b - trim, :]
    return x.mean(axis=(1, 3)).round().clip(0, 255).astype(np.uint8)


def undo_gamma(img, gamma):
    x = (img.astype(np.float64) / 255.0) ** (1.0 / gamma)
    return (np.clip(x, 0, 1) * 255.0).round().astype(np.uint8)


def main():
    OUT.mkdir(exist_ok=True)
    x, sr = sf.read(SAMPLES / "speech.wav")
    if x.ndim > 1:
        x = x.mean(axis=1)

    print(f"\nE1-blocks   clip=speech   damage={DAMAGE}\n")
    print("PESQ after the simulated channel, by pixels per spectrogram bin")
    header = f"{'scheme':12s}" + "".join(f"{f'{b}x{b}':>10s}" for b in BLOCKS)
    print(header)
    print("-" * len(header))

    table = {}
    for label, enc_kw in SCHEMES:
        img, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, **enc_kw)
        scores = []
        for b in BLOCKS:
            big = expand(img, b)
            damaged = channel.print_scan(big, seed=1, **DAMAGE)
            small = shrink(damaged, b)
            small = undo_gamma(small, GAMMA)
            y = codec.decode(small, meta)
            scores.append(metrics.evaluate(x, y, sr)["pesq"])
        table[label] = scores
        print(f"{label:12s}" + "".join(
            f"{s:10.2f}" if s is not None else f"{'--':>10s}" for s in scores))

    dur = len(x) / sr
    print(f"\nCapacity cost: at 300 dpi an A4 page is about 2480 by 3508 px.")
    bins = N_FFT // 2 + 1
    for b in BLOCKS:
        cols = 2480 // b
        strips = (3508 // b) // bins
        if strips == 0:
            print(f"  {b}x{b} blocks: one strip is {bins * b} px tall and does "
                  f"not fit the page at n_fft={N_FFT}")
            continue
        seconds = cols * strips * HOP / sr
        print(f"  {b}x{b} blocks: {strips} strip(s) per page, "
              f"about {seconds:6.1f} s of audio per page")
    print(f"  (test clip is {dur:.1f} s)")
    print("  A smaller n_fft yields fewer frequency bins and shorter strips,")
    print("  which is the knob that makes large blocks fit on a page.")

    fig, ax = plt.subplots(figsize=(7.5, 4.6))
    fig.patch.set_facecolor("white")
    colors = {"hsv": "#B3345C", "ifreq/8": "#2a9d8f", "gray": "#8B8595"}
    for label, scores in table.items():
        ax.plot(BLOCKS, [s if s is not None else np.nan for s in scores],
                "-o", label=label, color=colors[label], zorder=3)
    ax.set_xscale("log", base=2)
    ax.set_xticks(BLOCKS)
    ax.set_xticklabels([f"{b}x{b}" for b in BLOCKS])
    ax.set_xlabel("pixels per spectrogram bin  (more paper per value)")
    ax.set_ylabel("PESQ of recovered audio")
    ax.set_title("Spending paper to buy back audio quality")
    ax.grid(alpha=0.25, zorder=0)
    ax.legend(frameon=False)
    fig.tight_layout()
    out = OUT / "block_size.png"
    fig.savefig(out, dpi=150, facecolor="white")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
