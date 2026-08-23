"""Short-time Fourier analysis and synthesis.

Written out explicitly rather than pulled from a library so that every step of
the round trip is visible and controllable: the encoding experiments depend on
knowing exactly what happens to each complex bin.
"""

import numpy as np


def hann(n):
    # Periodic (not symmetric) Hann, which is the form that satisfies the
    # constant-overlap-add condition used by the synthesis below.
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n) / n)


def stft(x, n_fft=1024, hop=256):
    """Return complex spectrogram of shape (n_fft // 2 + 1, n_frames)."""
    w = hann(n_fft)
    # Pad so the first and last samples get full window coverage.
    pad = n_fft // 2
    xp = np.pad(x, pad, mode="reflect")
    n_frames = 1 + (len(xp) - n_fft) // hop
    frames = np.lib.stride_tricks.as_strided(
        xp,
        shape=(n_frames, n_fft),
        strides=(xp.strides[0] * hop, xp.strides[0]),
    )
    return np.fft.rfft(frames * w, axis=1).T


def istft(X, hop=256, length=None):
    """Weighted overlap-add inverse of `stft`."""
    n_fft = 2 * (X.shape[0] - 1)
    w = hann(n_fft)
    frames = np.fft.irfft(X.T, n=n_fft, axis=1)

    n_frames = frames.shape[0]
    out = np.zeros((n_frames - 1) * hop + n_fft)
    wsum = np.zeros_like(out)
    for i in range(n_frames):
        s = i * hop
        out[s:s + n_fft] += frames[i] * w
        wsum[s:s + n_fft] += w * w

    out /= np.maximum(wsum, 1e-10)
    pad = n_fft // 2
    out = out[pad:len(out) - pad]
    if length is not None:
        out = out[:length] if len(out) >= length else np.pad(out, (0, length - len(out)))
    return out


def griffin_lim(magnitude, hop=256, n_iter=64, length=None, seed=0):
    """Recover a signal from magnitude alone by iterative phase estimation.

    This is the stand-in for what a grayscale, magnitude-only encoding can do:
    the phase was thrown away, so it has to be guessed.
    """
    rng = np.random.default_rng(seed)
    phase = np.exp(2j * np.pi * rng.random(magnitude.shape))
    X = magnitude * phase
    for _ in range(n_iter):
        x = istft(X, hop=hop, length=length)
        X_new = stft(x, n_fft=2 * (magnitude.shape[0] - 1), hop=hop)
        # Keep the estimated phase, restore the known magnitude.
        X_new = X_new[:, :magnitude.shape[1]]
        if X_new.shape[1] < magnitude.shape[1]:
            X_new = np.pad(X_new, ((0, 0), (0, magnitude.shape[1] - X_new.shape[1])))
        X = magnitude * np.exp(1j * np.angle(X_new))
    return istft(X, hop=hop, length=length)
