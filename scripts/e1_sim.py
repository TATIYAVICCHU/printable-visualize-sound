"""E1-sim: which encoding survives a degraded channel?

E0 showed raw phase-as-hue is nearly transparent when the image is a clean PNG.
That result says nothing about paper, because a PNG has no ink spread and loses
no colour detail. This runs the same encodings through a simulated print and
capture cycle, where speckled hue is expected to suffer most.

The gamma correction is undone before decoding, standing in for the colour
calibration strip a real printed page would carry.
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

CONDITIONS = [
    ("clean", dict(blur=0.0, chroma=1, gamma=1.0, noise=0.0)),
    ("light", dict(blur=0.5, chroma=2, gamma=GAMMA, noise=0.005)),
    ("moderate", dict(blur=0.8, chroma=2, gamma=GAMMA, noise=0.01)),
    ("harsh", dict(blur=1.4, chroma=3, gamma=GAMMA, noise=0.02)),
]

SCHEMES = [
    ("hsv", dict(scheme="hsv")),
    ("ifreq/8", dict(scheme="ifreq", anchor=8)),
    ("ifreq/none", dict(scheme="ifreq", anchor=0)),
    ("gray", dict(scheme="gray")),
]


def undo_gamma(img, gamma):
    if gamma == 1.0:
        return img
    x = (img.astype(np.float64) / 255.0) ** (1.0 / gamma)
    return (np.clip(x, 0, 1) * 255.0).round().astype(np.uint8)


def main():
    OUT.mkdir(exist_ok=True)
    name = "speech"
    path = SAMPLES / f"{name}.wav"
    x, sr = sf.read(path)
    if x.ndim > 1:
        x = x.mean(axis=1)

    print(f"\nE1-sim   clip={name}   n_fft={N_FFT} hop={HOP}\n")
    header = f"{'scheme':12s}" + "".join(f"{c:>12s}" for c, _ in CONDITIONS)
    print("PESQ of recovered audio")
    print(header)
    print("-" * len(header))

    table = {}
    for label, enc_kw in SCHEMES:
        img, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, **enc_kw)
        scores = []
        for cond_name, cond in CONDITIONS:
            damaged = channel.print_scan(img, seed=1, **cond)
            damaged = undo_gamma(damaged, cond["gamma"])
            y = codec.decode(damaged, meta)
            m = metrics.evaluate(x, y, sr)
            scores.append(m["pesq"])
            if cond_name == "moderate":
                sf.write(OUT / f"{name}_{label.replace('/', '-')}_moderate.wav",
                         y.astype(np.float32), sr)
        table[label] = scores
        print(f"{label:12s}" + "".join(
            f"{s:12.2f}" if s is not None else f"{'--':>12s}" for s in scores))

    print("\nPESQ runs from about 1 (unintelligible) to 4.5 (indistinguishable).")

    fig, ax = plt.subplots(figsize=(7.5, 4.6))
    fig.patch.set_facecolor("white")
    colors = {"hsv": "#B3345C", "ifreq/8": "#2a9d8f",
              "ifreq/none": "#457b9d", "gray": "#8B8595"}
    xs = np.arange(len(CONDITIONS))
    for label, scores in table.items():
        ax.plot(xs, [s if s is not None else np.nan for s in scores],
                "-o", label=label, color=colors[label], zorder=3)
    ax.set_xticks(xs)
    ax.set_xticklabels([c for c, _ in CONDITIONS])
    ax.set_xlabel("simulated channel damage")
    ax.set_ylabel("PESQ of recovered audio")
    ax.set_title("Which encoding survives the channel")
    ax.grid(alpha=0.25, zorder=0)
    ax.legend(frameon=False)
    fig.tight_layout()
    out = OUT / "channel_survival.png"
    fig.savefig(out, dpi=150, facecolor="white")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
