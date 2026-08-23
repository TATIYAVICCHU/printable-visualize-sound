"""Create the test clips used by the experiments.

Speech comes from the macOS `say` command so that at least one clip is real
recorded-style audio rather than a synthetic tone. The rest are generated so
the experiments can be reproduced anywhere.
"""

import pathlib
import subprocess
import sys

import numpy as np
import soundfile as sf

SR = 16000
ROOT = pathlib.Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"


def write(name, x):
    x = x / max(np.abs(x).max(), 1e-9) * 0.9
    path = SAMPLES / f"{name}.wav"
    sf.write(path, x.astype(np.float32), SR)
    print(f"  {name:14s} {len(x) / SR:5.2f}s  {path}")
    return path


def speech():
    tmp = SAMPLES / "_tmp.wav"
    text = ("The quick brown fox jumps over the lazy dog. "
            "She sells sea shells by the sea shore.")
    subprocess.run(
        ["say", "-o", str(tmp), "--file-format=WAVE",
         "--data-format=LEI16@16000", text],
        check=True,
    )
    x, sr = sf.read(tmp)
    tmp.unlink()
    if x.ndim > 1:
        x = x.mean(axis=1)
    assert sr == SR, sr
    return write("speech", x)


def music():
    """A short arpeggiated chord sequence with decaying harmonics."""
    t = np.arange(int(SR * 4.0)) / SR
    x = np.zeros_like(t)
    chords = [[261.63, 329.63, 392.00], [220.00, 277.18, 329.63],
              [174.61, 220.00, 261.63], [196.00, 246.94, 293.66]]
    for i, chord in enumerate(chords):
        for j, f0 in enumerate(chord):
            onset = i * 1.0 + j * 0.12
            env = np.where(t >= onset, np.exp(-(t - onset) * 2.2), 0.0)
            for h, amp in enumerate([1.0, 0.5, 0.28, 0.14], start=1):
                x += amp * env * np.sin(2 * np.pi * f0 * h * t)
    return write("music", x)


def noise_burst():
    """An environmental-style clip: filtered noise bursts over a hum."""
    rng = np.random.default_rng(7)
    t = np.arange(int(SR * 3.0)) / SR
    x = 0.15 * np.sin(2 * np.pi * 120 * t)
    for onset in [0.3, 1.1, 1.9, 2.4]:
        env = np.where(t >= onset, np.exp(-(t - onset) * 12.0), 0.0)
        x += env * rng.normal(0, 1, len(t))
    return write("environment", x)


def chirp():
    """A frequency sweep: the clearest possible visual read of the encoding."""
    t = np.arange(int(SR * 2.0)) / SR
    f = 80.0 * (4000.0 / 80.0) ** (t / t[-1])
    phase = 2 * np.pi * np.cumsum(f) / SR
    return write("chirp", np.sin(phase))


if __name__ == "__main__":
    SAMPLES.mkdir(exist_ok=True)
    print("writing samples:")
    try:
        speech()
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  speech skipped ({e})", file=sys.stderr)
    music()
    noise_burst()
    chirp()
