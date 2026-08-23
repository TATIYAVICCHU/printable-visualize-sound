/**
 * Iterative radix-2 Cooley-Tukey FFT. Operates in place on parallel
 * real/imaginary arrays whose length must be a power of two.
 */

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function bitReverse(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
}

/** In-place FFT (sign = -1) or inverse FFT (sign = +1, unnormalized). */
function fftCore(re: Float64Array, im: Float64Array, sign: number) {
  const n = re.length;
  if (!isPowerOfTwo(n)) throw new Error(`fft size must be a power of two, got ${n}`);
  bitReverse(re, im);

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angStep = (sign * 2 * Math.PI) / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const ang = angStep * k;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const aRe = re[start + k];
        const aIm = im[start + k];
        const bRe = re[start + k + half];
        const bIm = im[start + k + half];
        const tRe = bRe * wr - bIm * wi;
        const tIm = bRe * wi + bIm * wr;
        re[start + k] = aRe + tRe;
        im[start + k] = aIm + tIm;
        re[start + k + half] = aRe - tRe;
        im[start + k + half] = aIm - tIm;
      }
    }
  }
}

/** Full complex FFT. Inputs are copied, not mutated. */
export function fft(re: Float64Array, im: Float64Array): [Float64Array, Float64Array] {
  const r = Float64Array.from(re);
  const i = Float64Array.from(im);
  fftCore(r, i, -1);
  return [r, i];
}

/** Full complex inverse FFT, normalized by 1/n. */
export function ifft(re: Float64Array, im: Float64Array): [Float64Array, Float64Array] {
  const n = re.length;
  const r = Float64Array.from(re);
  const i = Float64Array.from(im);
  fftCore(r, i, 1);
  for (let k = 0; k < n; k++) {
    r[k] /= n;
    i[k] /= n;
  }
  return [r, i];
}

/** Real-input FFT: returns only bins 0..n/2 (the non-redundant half). */
export function rfft(signal: Float64Array): [Float64Array, Float64Array] {
  const n = signal.length;
  const im = new Float64Array(n);
  const [re, imAll] = fft(signal, im);
  const half = n / 2 + 1;
  return [re.slice(0, half), imAll.slice(0, half)];
}

/** Inverse of rfft: reconstructs the full spectrum via Hermitian symmetry. */
export function irfft(re: Float64Array, im: Float64Array, n: number): Float64Array {
  const fullRe = new Float64Array(n);
  const fullIm = new Float64Array(n);
  const half = n / 2 + 1;
  for (let k = 0; k < half; k++) {
    fullRe[k] = re[k];
    fullIm[k] = im[k];
  }
  for (let k = 1; k < n - half + 1; k++) {
    fullRe[n - k] = re[k];
    fullIm[n - k] = -im[k];
  }
  const [outRe] = ifft(fullRe, fullIm);
  return outRe;
}
