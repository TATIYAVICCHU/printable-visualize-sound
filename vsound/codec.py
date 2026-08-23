"""Encode a complex spectrogram into a color image, and decode it back.

Two schemes are implemented so they can be compared directly:

  hsv    raw phase becomes hue, log magnitude becomes value. Phase is
         preserved, so decoding is a direct inverse rather than a guess.
  ifreq  the same, except hue carries how far each bin's phase advance departs
         from the advance that bin would have if it held a steady tone. For
         tonal sound that quantity barely changes frame to frame, so the hue
         field comes out smooth instead of speckled.
  gray   magnitude only, as a grayscale image. This is the PhonoPaper-style
         baseline: the phase is gone and has to be reconstructed iteratively.
"""

import json

import numpy as np
from matplotlib.colors import hsv_to_rgb, rgb_to_hsv
from PIL import Image

from .stft import stft, istft, griffin_lim

DB_FLOOR = -80.0  # magnitudes this far below the peak are treated as silence


def _magnitude_to_value(magnitude, ref):
    """Map linear magnitude to [0, 1] through a dB scale."""
    db = 20.0 * np.log10(np.maximum(magnitude, 1e-12) / ref)
    db = np.clip(db, DB_FLOOR, 0.0)
    return (db - DB_FLOOR) / (0.0 - DB_FLOOR)


def _value_to_magnitude(value, ref):
    db = value * (0.0 - DB_FLOOR) + DB_FLOOR
    return ref * (10.0 ** (db / 20.0))


def _wrap(a):
    """Wrap angles into [-pi, pi)."""
    return (a + np.pi) % (2.0 * np.pi) - np.pi


def _expected_advance(n_bins, n_fft, hop):
    """Phase advance per frame for a steady tone at each bin's centre."""
    return 2.0 * np.pi * hop * np.arange(n_bins) / n_fft


def phase_to_ifreq(phase, n_fft, hop, anchor=0):
    """Rewrite absolute phase as its frame-to-frame deviation.

    Deviation columns have to be integrated to be read back, so any error in
    one column shifts every column after it. Setting `anchor` to N stores
    absolute phase every N columns, which caps how far an error can travel at
    the cost of reintroducing speckle in those columns.
    """
    adv = _expected_advance(phase.shape[0], n_fft, hop)[:, None]
    d = np.empty_like(phase)
    d[:, :1] = phase[:, :1]
    d[:, 1:] = _wrap(np.diff(phase, axis=1) - adv)
    if anchor:
        cols = np.arange(0, phase.shape[1], anchor)
        d[:, cols] = phase[:, cols]
    return d


def ifreq_to_phase(d, n_fft, hop, anchor=0):
    """Integrate deviations back into absolute phase."""
    adv = _expected_advance(d.shape[0], n_fft, hop)[:, None]
    if not anchor:
        phase = np.empty_like(d)
        phase[:, :1] = d[:, :1]
        phase[:, 1:] = phase[:, :1] + np.cumsum(d[:, 1:] + adv, axis=1)
        return phase

    phase = np.empty_like(d)
    for t in range(d.shape[1]):
        if t % anchor == 0:
            phase[:, t] = d[:, t]
        else:
            phase[:, t] = phase[:, t - 1] + adv[:, 0] + d[:, t]
    return phase


def encode(x, sr, n_fft=1024, hop=256, scheme="hsv", anchor=0):
    """Turn a waveform into an image array (uint8, H x W x 3) plus metadata."""
    X = stft(x, n_fft=n_fft, hop=hop)
    magnitude = np.abs(X)
    ref = float(magnitude.max())
    value = _magnitude_to_value(magnitude, ref)

    if scheme in ("hsv", "ifreq"):
        angle = np.angle(X)
        if scheme == "ifreq":
            angle = phase_to_ifreq(angle, n_fft, hop, anchor)
        hue = (angle / (2.0 * np.pi)) % 1.0
        hsv = np.stack([hue, np.ones_like(value), value], axis=-1)
        rgb = hsv_to_rgb(hsv)
    elif scheme == "gray":
        rgb = np.stack([value] * 3, axis=-1)
    else:
        raise ValueError(f"unknown scheme: {scheme}")

    # Flip so low frequencies sit at the bottom, as in a conventional spectrogram.
    img = np.flipud((rgb * 255.0).round().astype(np.uint8))

    meta = {
        "scheme": scheme,
        "sr": sr,
        "n_fft": n_fft,
        "hop": hop,
        "ref": ref,
        "anchor": anchor,
        "db_floor": DB_FLOOR,
        "n_samples": int(len(x)),
    }
    return img, meta


def decode(img, meta, gl_iters=64):
    """Turn an image array back into a waveform."""
    rgb = np.flipud(img).astype(np.float64) / 255.0
    ref = meta["ref"]
    hop = meta["hop"]
    length = meta["n_samples"]

    if meta["scheme"] in ("hsv", "ifreq"):
        hsv = rgb_to_hsv(rgb)
        hue, value = hsv[..., 0], hsv[..., 2]
        magnitude = _value_to_magnitude(value, ref)
        angle = hue * 2.0 * np.pi
        if meta["scheme"] == "ifreq":
            # Hue held deviations in [-pi, pi); undo the shift into [0, 2pi).
            angle = ifreq_to_phase(_wrap(angle), meta["n_fft"], hop,
                                   meta.get("anchor", 0))
        return istft(magnitude * np.exp(1j * angle), hop=hop, length=length)

    if meta["scheme"] == "gray":
        value = rgb[..., 0]
        magnitude = _value_to_magnitude(value, ref)
        return griffin_lim(magnitude, hop=hop, n_iter=gl_iters, length=length)

    raise ValueError(f"unknown scheme: {meta['scheme']}")


def save(path, img, meta):
    Image.fromarray(img).save(path)
    with open(str(path).replace(".png", ".json"), "w") as f:
        json.dump(meta, f, indent=2)


def load(path):
    img = np.array(Image.open(path).convert("RGB"))
    with open(str(path).replace(".png", ".json")) as f:
        meta = json.load(f)
    return img, meta
