"""Folding a linear sequence into a square picture.

A spectrogram is a matrix, but only one of its axes is frequency: the other is
still time, so the picture grows into a long strip and reads like every
spectrogram in every audio editor. Getting a genuinely square image means
deciding how the long axis folds back on itself.

Two foldings are provided.

  serpentine  the long axis wraps like lines of text, each row read left to
              right, the next row beginning below. Simple and reversible, but
              it does cut the sequence at fixed points, and neighbours across a
              cut land far apart on the page.

  hilbert     the sequence is laid along a Hilbert space-filling curve. The
              curve visits every cell of a square exactly once and never jumps:
              consecutive entries are always physically adjacent, and entries
              close in the sequence stay close on the page. There is no cut
              point anywhere.

Both are permutations of the same cells, so neither loses information and
neither changes recovered audio quality on its own. What they change is the
shape of the page and how damage spreads: under a blur, the Hilbert layout
mixes each cell with sequence neighbours, while a serpentine cut mixes cells
that are seconds apart.
"""

import numpy as np


def hilbert_curve(order):
    """Return the x and y of every point along a Hilbert curve, in order.

    The curve fills a square of side 2**order. Index i of the returned arrays
    gives the cell that the i-th element of a sequence occupies.
    """
    n = 1 << order
    d = np.arange(n * n, dtype=np.int64)
    x = np.zeros(n * n, dtype=np.int64)
    y = np.zeros(n * n, dtype=np.int64)
    t = d.copy()

    s = 1
    while s < n:
        rx = 1 & (t >> 1)
        ry = 1 & (t ^ rx)

        # Reflect and transpose the quadrant so the curve joins up end to end.
        flip = (ry == 0)
        xf = np.where(flip & (rx == 1), s - 1 - x, x)
        yf = np.where(flip & (rx == 1), s - 1 - y, y)
        x, y = np.where(flip, yf, xf), np.where(flip, xf, yf)

        x += s * rx
        y += s * ry
        t >>= 2
        s <<= 1

    return x, y


def _order_for(n_cells):
    order = 0
    while (1 << order) ** 2 < n_cells:
        order += 1
    return order


def to_square(cells, kind="hilbert"):
    """Fold a sequence of cells (N x C) into a square image (S x S x C).

    Cells beyond the end of the sequence are left black, standing for silence.
    """
    n_cells, n_ch = cells.shape

    if kind == "hilbert":
        order = _order_for(n_cells)
        side = 1 << order
        xs, ys = hilbert_curve(order)
    elif kind == "serpentine":
        side = int(np.ceil(np.sqrt(n_cells)))
        idx = np.arange(side * side)
        ys, xs = np.divmod(idx, side)
        # Reverse every other row so the reading order never jumps.
        xs = np.where(ys % 2 == 1, side - 1 - xs, xs)
    else:
        raise ValueError(f"unknown layout: {kind}")

    img = np.zeros((side, side, n_ch), dtype=cells.dtype)
    img[ys[:n_cells], xs[:n_cells]] = cells
    return img, {"layout": kind, "side": side, "n_cells": n_cells}


def from_square(img, info):
    """Unfold a square image back into the original sequence of cells."""
    kind, side, n_cells = info["layout"], info["side"], info["n_cells"]

    if kind == "hilbert":
        xs, ys = hilbert_curve(_order_for(n_cells))
    elif kind == "serpentine":
        idx = np.arange(side * side)
        ys, xs = np.divmod(idx, side)
        xs = np.where(ys % 2 == 1, side - 1 - xs, xs)
    else:
        raise ValueError(f"unknown layout: {kind}")

    return img[ys[:n_cells], xs[:n_cells]]


def spectrogram_to_cells(img_ft):
    """Flatten a frequency-by-time image into one sequence, time first.

    Reading frame by frame keeps a whole moment of sound together in the
    sequence, so a locality-preserving fold keeps that moment together on the
    page as well.
    """
    n_f, n_t, n_ch = img_ft.shape
    return img_ft.transpose(1, 0, 2).reshape(n_t * n_f, n_ch), (n_f, n_t)


def cells_to_spectrogram(cells, shape):
    n_f, n_t = shape
    return cells.reshape(n_t, n_f, -1).transpose(1, 0, 2)
