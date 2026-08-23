"""Quality measures comparing recovered audio against the original."""

import numpy as np

from .stft import stft


def snr_db(reference, test):
    """Signal-to-noise ratio treating the difference as noise."""
    n = min(len(reference), len(test))
    reference, test = reference[:n], test[:n]
    noise = reference - test
    denom = np.sum(noise ** 2)
    if denom < 1e-20:
        return float("inf")
    return float(10.0 * np.log10(np.sum(reference ** 2) / denom))


def log_spectral_distance(reference, test, n_fft=1024, hop=256, floor_db=-80.0):
    """Distance between the two log-magnitude spectrograms, in dB.

    Both spectrograms are clamped to a shared floor set relative to the
    reference peak. Without this, bins that are effectively silent dominate the
    average: the encoder deliberately discards everything below its own floor,
    so comparing those bins measures the floor rather than any audible damage.
    """
    n = min(len(reference), len(test))
    A = np.abs(stft(reference[:n], n_fft=n_fft, hop=hop))
    B = np.abs(stft(test[:n], n_fft=n_fft, hop=hop))
    ref_peak = max(A.max(), 1e-12)

    A = np.clip(20.0 * np.log10(np.maximum(A, 1e-12) / ref_peak), floor_db, 0.0)
    B = np.clip(20.0 * np.log10(np.maximum(B, 1e-12) / ref_peak), floor_db, 0.0)
    return float(np.sqrt(np.mean((A - B) ** 2)))


def hue_roughness(img):
    """How violently hue changes between neighbouring pixels, in turns.

    Zero means a perfectly flat hue field, 0.5 means neighbours land on
    opposite sides of the colour wheel. High roughness is what makes an image
    hard to read by eye and fragile under printing, where fine colour detail is
    the first thing lost.

    Differences are weighted by brightness so that silent regions, whose hue
    carries no audio and prints as black anyway, do not dominate.
    """
    from matplotlib.colors import rgb_to_hsv

    hsv = rgb_to_hsv(img.astype(np.float64) / 255.0)
    hue, value = hsv[..., 0], hsv[..., 2]

    total, weight = 0.0, 0.0
    for axis in (0, 1):
        d = np.abs(np.diff(hue, axis=axis))
        d = np.minimum(d, 1.0 - d)  # shortest way round the wheel
        w = np.minimum(value.take(np.arange(value.shape[axis] - 1), axis=axis),
                       value.take(np.arange(1, value.shape[axis]), axis=axis))
        total += float((d * w).sum())
        weight += float(w.sum())
    return total / max(weight, 1e-9)


def stoi_score(reference, test, sr):
    """Short-time objective intelligibility, 0 to 1."""
    from pystoi import stoi

    n = min(len(reference), len(test))
    return float(stoi(reference[:n], test[:n], sr, extended=False))


def pesq_score(reference, test, sr):
    """Perceptual evaluation of speech quality, roughly 1 (bad) to 4.5 (clean)."""
    from pesq import pesq

    if sr not in (8000, 16000):
        return None
    mode = "wb" if sr == 16000 else "nb"
    n = min(len(reference), len(test))
    try:
        return float(pesq(sr, reference[:n], test[:n], mode))
    except Exception:
        return None


def evaluate(reference, test, sr):
    return {
        "snr_db": snr_db(reference, test),
        "lsd_db": log_spectral_distance(reference, test),
        "stoi": stoi_score(reference, test, sr),
        "pesq": pesq_score(reference, test, sr),
    }
