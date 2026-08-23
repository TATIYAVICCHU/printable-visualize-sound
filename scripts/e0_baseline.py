"""E0: the digital baseline.

No printer is involved yet. This measures how much audio quality is lost purely
by turning sound into an 8-bit color image and back, which sets the ceiling for
everything the physical experiments can achieve later.

Three conditions per clip:

  control  spectrogram straight back to audio, never becoming an image.
           Isolates the loss caused by the transform itself.
  hsv      phase as hue, log magnitude as value, through a real PNG file.
  gray     magnitude only, phase discarded and re-estimated on decode.
           Stands in for the existing grayscale approach.
"""

import pathlib
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from vsound import codec, metrics
from vsound.stft import stft, istft

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
OUT = ROOT / "out"

N_FFT = 1024
HOP = 256


def control(x, sr):
    X = stft(x, n_fft=N_FFT, hop=HOP)
    return istft(X, hop=HOP, length=len(x))


def through_image(x, sr, scheme, stem):
    img, meta = codec.encode(x, sr, n_fft=N_FFT, hop=HOP, scheme=scheme)
    png = OUT / f"{stem}_{scheme}.png"
    codec.save(png, img, meta)
    img2, meta2 = codec.load(png)
    y = codec.decode(img2, meta2)
    return y, img, png.stat().st_size


def fmt(v, spec="7.2f"):
    if v is None:
        return "     --"
    if v == float("inf"):
        return "    inf"
    return format(v, spec)


def main():
    OUT.mkdir(exist_ok=True)
    clips = sorted(SAMPLES.glob("*.wav"))
    if not clips:
        sys.exit("no samples found: run scripts/make_samples.py first")

    print(f"\nE0 digital baseline   n_fft={N_FFT} hop={HOP}\n")
    header = (f"{'clip':13s}{'condition':10s}{'SNR dB':>8s}{'LSD dB':>8s}"
              f"{'STOI':>8s}{'PESQ':>8s}{'hue rough':>11s}   image")
    print(header)
    print("-" * len(header))

    for path in clips:
        x, sr = sf.read(path)
        if x.ndim > 1:
            x = x.mean(axis=1)
        stem = path.stem

        rows = []
        y = control(x, sr)
        rows.append(("control", metrics.evaluate(x, y, sr), None, None, None))

        for scheme in ("hsv", "ifreq", "gray"):
            y, img, size = through_image(x, sr, scheme, stem)
            sf.write(OUT / f"{stem}_{scheme}_decoded.wav", y.astype(np.float32), sr)
            rough = None if scheme == "gray" else metrics.hue_roughness(img)
            rows.append((scheme, metrics.evaluate(x, y, sr), img.shape, size, rough))

        for i, (name, m, shape, size, rough) in enumerate(rows):
            label = stem if i == 0 else ""
            img_desc = ""
            if shape is not None:
                img_desc = f"{shape[1]}x{shape[0]}px  {size / 1024:6.1f} KB"
            print(f"{label:13s}{name:10s}"
                  f"{fmt(m['snr_db'])}{fmt(m['lsd_db'])}"
                  f"{fmt(m['stoi'], '8.3f')}{fmt(m['pesq'], '8.2f')}"
                  f"{fmt(rough, '11.3f')}   {img_desc}")
        print()

    print("SNR and PESQ higher is better; LSD and hue roughness lower is better.")
    print("Hue roughness is how far neighbouring pixels sit apart on the colour")
    print("wheel: 0 is a flat field, 0.5 is opposite colours touching.")
    print(f"images and decoded audio written to {OUT}")


if __name__ == "__main__":
    main()
