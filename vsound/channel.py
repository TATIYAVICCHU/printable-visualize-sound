"""A stand-in for printing an image and photographing it again.

This is a simulation, not a substitute for the real thing: it applies the
distortions a print-and-capture cycle is known to introduce, so that encoding
choices can be compared before any paper is involved. Real printers and cameras
will behave differently, and the physical experiments remain the actual test.

The distortions applied, in the order they occur physically:

  ink spread     printed dots bleed into their neighbours
  chroma loss    fine colour detail survives far worse than fine brightness
                 detail, in printing as in image compression
  tone curve     printed midtones sit darker than the file asks for
  sensor noise   the camera adds its own grain
"""

import numpy as np
from scipy.ndimage import gaussian_filter, zoom

# Coefficients of the standard luma/chroma separation used by image and video
# formats; chroma is the part that gets thrown away first.
_RGB_TO_YCC = np.array([[0.299, 0.587, 0.114],
                        [-0.168736, -0.331264, 0.5],
                        [0.5, -0.418688, -0.081312]])
_YCC_TO_RGB = np.linalg.inv(_RGB_TO_YCC)


def _chroma_subsample(rgb, factor):
    ycc = rgb @ _RGB_TO_YCC.T
    ycc[..., 1:] += 0.5
    for c in (1, 2):
        small = zoom(ycc[..., c], 1.0 / factor, order=1)
        ycc[..., c] = zoom(small, np.array(ycc.shape[:2]) / np.array(small.shape),
                           order=1)[:ycc.shape[0], :ycc.shape[1]]
    ycc[..., 1:] -= 0.5
    return ycc @ _YCC_TO_RGB.T


def print_scan(img, blur=0.8, chroma=2, gamma=1.15, noise=0.01, seed=0):
    """Push an 8-bit image through the simulated channel and back to 8-bit."""
    rng = np.random.default_rng(seed)
    x = img.astype(np.float64) / 255.0

    if blur:
        x = gaussian_filter(x, sigma=(blur, blur, 0))
    if chroma and chroma > 1:
        x = _chroma_subsample(x, chroma)
    if gamma and gamma != 1.0:
        x = np.clip(x, 0.0, 1.0) ** gamma
    if noise:
        x = x + rng.normal(0.0, noise, x.shape)

    return (np.clip(x, 0.0, 1.0) * 255.0).round().astype(np.uint8)
