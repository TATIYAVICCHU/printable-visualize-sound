/** Fold a spectrogram image onto a square page via a Hilbert curve. Port of vsound/layout.py. */

function orderFor(nCells: number): number {
  let order = 0;
  while (Math.pow(1 << order, 2) < nCells) order++;
  return order;
}

/** x[i], y[i] give the cell visited at step i of a Hilbert curve filling a 2^order square. */
export function hilbertCurve(order: number): { x: Int32Array; y: Int32Array } {
  const n = 1 << order;
  const total = n * n;
  const x = new Int32Array(total);
  const y = new Int32Array(total);

  for (let d = 0; d < total; d++) {
    let rx = 0, ry = 0, t = d, cx = 0, cy = 0;
    for (let s = 1; s < n; s <<= 1) {
      rx = 1 & (t >> 1);
      ry = 1 & (t ^ rx);
      // rotate
      if (ry === 0) {
        if (rx === 1) {
          cx = s - 1 - cx;
          cy = s - 1 - cy;
        }
        [cx, cy] = [cy, cx];
      }
      cx += s * rx;
      cy += s * ry;
      t >>= 2;
    }
    x[d] = cx;
    y[d] = cy;
  }
  return { x, y };
}

/**
 * Fold a [height][width] RGBA image (frequency x time) into a square RGBA
 * image via a Hilbert curve, reading time-major (whole time-frames stay
 * together in the sequence, matching vsound.layout.spectrogram_to_cells).
 */
export function toHilbertSquare(width: number, height: number, data: Uint8ClampedArray): {
  side: number; data: Uint8ClampedArray; nCells: number;
} {
  const nCells = width * height;
  const order = orderFor(nCells);
  const side = 1 << order;
  const { x, y } = hilbertCurve(order);

  const out = new Uint8ClampedArray(side * side * 4);
  // Column-major traversal (down each time-column before moving to the next)
  // keeps a whole time-frame together in the sequence, so it stays together
  // on the page too.
  let cell = 0;
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      const si = (row * width + col) * 4;
      const di = (y[cell] * side + x[cell]) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
      cell++;
    }
  }
  return { side, data: out, nCells };
}

export function fromHilbertSquare(side: number, data: Uint8ClampedArray, width: number, height: number, nCells: number): Uint8ClampedArray {
  const order = orderFor(nCells);
  const { x, y } = hilbertCurve(order);
  const out = new Uint8ClampedArray(width * height * 4);
  let cell = 0;
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      const si = (y[cell] * side + x[cell]) * 4;
      const di = (row * width + col) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
      cell++;
    }
  }
  return out;
}
