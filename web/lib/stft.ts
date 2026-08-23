/**
 * Short-time Fourier analysis and synthesis. Port of vsound/stft.py.
 *
 * A complex spectrogram is represented as two Float64Array2D grids (re, im),
 * each shaped [nBins][nFrames] — bin 0 is the lowest frequency, matching the
 * Python reference implementation.
 */

import { rfft, irfft } from "./fft";

export interface Spectrogram {
  re: Float64Array[]; // [bin][frame]
  im: Float64Array[];
  nFft: number;
  hop: number;
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}

function reflectPad(x: Float32Array | Float64Array, pad: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n + 2 * pad);
  for (let i = 0; i < n; i++) out[pad + i] = x[i];
  for (let i = 0; i < pad; i++) {
    out[pad - 1 - i] = x[Math.min(i + 1, n - 1)];
    out[pad + n + i] = x[Math.max(n - 2 - i, 0)];
  }
  return out;
}

export function stft(x: Float32Array | Float64Array, nFft = 1024, hop = 256): Spectrogram {
  const w = hann(nFft);
  const pad = nFft >> 1;
  const xp = reflectPad(x, pad);
  const nFrames = 1 + Math.floor((xp.length - nFft) / hop);
  const nBins = nFft / 2 + 1;

  const re: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  const im: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));

  const frame = new Float64Array(nFft);
  for (let t = 0; t < nFrames; t++) {
    const start = t * hop;
    for (let i = 0; i < nFft; i++) frame[i] = xp[start + i] * w[i];
    const [fre, fim] = rfft(frame);
    for (let f = 0; f < nBins; f++) {
      re[f][t] = fre[f];
      im[f][t] = fim[f];
    }
  }

  return { re, im, nFft, hop };
}

export function istft(spec: Spectrogram, length?: number): Float64Array {
  const { re, im, nFft, hop } = spec;
  const nBins = re.length;
  const nFrames = re[0].length;
  const w = hann(nFft);

  const outLen = (nFrames - 1) * hop + nFft;
  const out = new Float64Array(outLen);
  const wsum = new Float64Array(outLen);

  const binRe = new Float64Array(nBins);
  const binIm = new Float64Array(nBins);

  for (let t = 0; t < nFrames; t++) {
    for (let f = 0; f < nBins; f++) {
      binRe[f] = re[f][t];
      binIm[f] = im[f][t];
    }
    const frame = irfft(binRe, binIm, nFft);
    const start = t * hop;
    for (let i = 0; i < nFft; i++) {
      out[start + i] += frame[i] * w[i];
      wsum[start + i] += w[i] * w[i];
    }
  }

  for (let i = 0; i < outLen; i++) out[i] /= Math.max(wsum[i], 1e-10);

  const pad = nFft >> 1;
  const trimmed = out.slice(pad, outLen - pad);
  if (length === undefined) return trimmed;
  if (trimmed.length >= length) return trimmed.slice(0, length);
  const padded = new Float64Array(length);
  padded.set(trimmed);
  return padded;
}

/** Recover a signal from magnitude alone via iterative phase estimation. */
export function griffinLim(
  magnitude: Float64Array[],
  nFft: number,
  hop: number,
  nIter = 32,
  length?: number,
  seed = 1234,
): Float64Array {
  const nBins = magnitude.length;
  const nFrames = magnitude[0].length;

  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const re: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  const im: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  for (let f = 0; f < nBins; f++) {
    for (let t = 0; t < nFrames; t++) {
      const phase = rand() * 2 * Math.PI;
      re[f][t] = magnitude[f][t] * Math.cos(phase);
      im[f][t] = magnitude[f][t] * Math.sin(phase);
    }
  }

  let x = istft({ re, im, nFft, hop }, length);
  for (let iter = 0; iter < nIter; iter++) {
    const est = stft(x, nFft, hop);
    for (let f = 0; f < nBins; f++) {
      for (let t = 0; t < Math.min(nFrames, est.re[f].length); t++) {
        const eRe = est.re[f][t];
        const eIm = est.im[f][t];
        const mag = Math.hypot(eRe, eIm) || 1e-9;
        const scale = magnitude[f][t] / mag;
        re[f][t] = eRe * scale;
        im[f][t] = eIm * scale;
      }
    }
    x = istft({ re, im, nFft, hop }, length);
  }
  return x;
}
