"""E0b: the smoothness / drift trade-off in phase-derivative encoding.

Encoding phase as a deviation makes the picture smooth, which is what a printer
and a camera can actually reproduce, but the decoder has to integrate those
deviations, so errors travel forward in time. Storing absolute phase every N
columns limits that travel. This sweep finds where the two effects balance.

Anchor 1 stores absolute phase in every column, which is exactly the raw-phase
scheme, and serves as a check that the two code paths agree.
"""

import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import codec, metrics

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
OUT = ROOT / "out"

N_FFT = 1024
HOP = 256
ANCHORS = [0, 128, 64, 32, 16, 8, 4, 2, 1]


def run(x, sr, anchor):
    img, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP,
                             scheme="ifreq", anchor=anchor)
    y = codec.decode(img, meta)
    m = metrics.evaluate(x, y, sr)
    m["rough"] = metrics.hue_roughness(img)
    return m


def main():
    OUT.mkdir(exist_ok=True)
    names = ["speech", "music"]
    results = {}

    print(f"\nE0b anchor sweep   n_fft={N_FFT} hop={HOP}\n")
    for name in names:
        path = SAMPLES / f"{name}.wav"
        if not path.exists():
            continue
        x, sr = sf.read(path)
        if x.ndim > 1:
            x = x.mean(axis=1)

        print(f"{name}")
        print(f"  {'anchor':>8s}{'PESQ':>8s}{'STOI':>8s}{'LSD dB':>9s}{'hue rough':>11s}")
        rows = []
        for a in ANCHORS:
            m = run(x, sr, a)
            rows.append((a, m))
            label = "none" if a == 0 else str(a)
            print(f"  {label:>8s}{m['pesq'] or float('nan'):8.2f}{m['stoi']:8.3f}"
                  f"{m['lsd_db']:9.2f}{m['rough']:11.3f}")
        results[name] = rows
        print()

    # Plot quality against smoothness so the trade-off is visible at a glance.
    fig, ax = plt.subplots(1, len(results), figsize=(6 * len(results), 4.6),
                           squeeze=False)
    fig.patch.set_facecolor("white")
    for i, (name, rows) in enumerate(results.items()):
        a = ax[0][i]
        rough = [r[1]["rough"] for r in rows]
        pesq = [r[1]["pesq"] or np.nan for r in rows]
        a.plot(rough, pesq, "-o", color="#B3345C", zorder=3)
        for (anchor, m), rx, py in zip(rows, rough, pesq):
            a.annotate("no anchor" if anchor == 0 else f"every {anchor}",
                       (rx, py), textcoords="offset points", xytext=(6, 5),
                       fontsize=7.5, color="#55505E")
        a.set_xlabel("hue roughness  (lower = smoother, more printable)")
        a.set_ylabel("PESQ  (higher = better recovered audio)")
        a.set_title(name)
        a.grid(alpha=0.25, zorder=0)
    fig.suptitle("Smoother images cost audio quality: where the anchor lands",
                 fontsize=12)
    fig.tight_layout()
    out = OUT / "anchor_tradeoff.png"
    fig.savefig(out, dpi=150, facecolor="white")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
