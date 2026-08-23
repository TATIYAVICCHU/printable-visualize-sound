/**
 * Encode a complex spectrogram into an image, and decode it back.
 * Port of vsound/codec.py.
 */

import { stft, istft, griffinLim } from "./stft";

export type Scheme = "hsv" | "ifreq" | "gray";

export interface Meta {
  scheme: Scheme;
  sr: number;
  nFft: number;
  hop: number;
  ref: number;
  anchor: number;
  nSamples: number;
}

const DB_FLOOR = -80;

function magnitudeToValue(mag: number, ref: number): number {
  const db = Math.max(20 * Math.log10(Math.max(mag, 1e-12) / ref), DB_FLOOR);
  const clamped = Math.min(db, 0);
  return (clamped - DB_FLOOR) / (0 - DB_FLOOR);
}

function valueToMagnitude(value: number, ref: number): number {
  const db = value * (0 - DB_FLOOR) + DB_FLOOR;
  return ref * Math.pow(10, db / 20);
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, v];
}

function wrap(a: number): number {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function expectedAdvance(nBins: number, nFft: number, hop: number): Float64Array {
  const adv = new Float64Array(nBins);
  for (let f = 0; f < nBins; f++) adv[f] = (2 * Math.PI * hop * f) / nFft;
  return adv;
}

function phaseToIfreq(phase: Float64Array[], nFft: number, hop: number, anchor: number): Float64Array[] {
  const nBins = phase.length, nFrames = phase[0].length;
  const adv = expectedAdvance(nBins, nFft, hop);
  const out: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  for (let f = 0; f < nBins; f++) {
    out[f][0] = phase[f][0];
    for (let t = 1; t < nFrames; t++) {
      out[f][t] = wrap(phase[f][t] - phase[f][t - 1] - adv[f]);
    }
    if (anchor) {
      for (let t = 0; t < nFrames; t += anchor) out[f][t] = phase[f][t];
    }
  }
  return out;
}

function ifreqToPhase(dev: Float64Array[], nFft: number, hop: number, anchor: number): Float64Array[] {
  const nBins = dev.length, nFrames = dev[0].length;
  const adv = expectedAdvance(nBins, nFft, hop);
  const out: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  if (!anchor) {
    for (let f = 0; f < nBins; f++) {
      out[f][0] = dev[f][0];
      for (let t = 1; t < nFrames; t++) out[f][t] = out[f][t - 1] + adv[f] + dev[f][t];
    }
    return out;
  }
  for (let f = 0; f < nBins; f++) {
    for (let t = 0; t < nFrames; t++) {
      if (t % anchor === 0) out[f][t] = dev[f][t];
      else out[f][t] = out[f][t - 1] + adv[f] + dev[f][t];
    }
  }
  return out;
}

export interface EncodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major, low frequency at bottom row
  meta: Meta;
}

export function encode(
  x: Float32Array | Float64Array,
  sr: number,
  scheme: Scheme,
  nFft = 1024,
  hop = 256,
  anchor = 0,
): EncodedImage {
  const spec = stft(x, nFft, hop);
  const nBins = spec.re.length, nFrames = spec.re[0].length;

  let ref = 0;
  const mag: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  for (let f = 0; f < nBins; f++) {
    for (let t = 0; t < nFrames; t++) {
      const m = Math.hypot(spec.re[f][t], spec.im[f][t]);
      mag[f][t] = m;
      if (m > ref) ref = m;
    }
  }
  ref = Math.max(ref, 1e-12);

  const value: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  for (let f = 0; f < nBins; f++)
    for (let t = 0; t < nFrames; t++) value[f][t] = magnitudeToValue(mag[f][t], ref);

  const data = new Uint8ClampedArray(nFrames * nBins * 4);
  const width = nFrames, height = nBins;

  if (scheme === "gray") {
    for (let f = 0; f < nBins; f++) {
      for (let t = 0; t < nFrames; t++) {
        const row = height - 1 - f; // flip so low freq at bottom
        const idx = (row * width + t) * 4;
        const v = Math.round(value[f][t] * 255);
        data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
      }
    }
  } else {
    let angle: Float64Array[] = Array.from({ length: nBins }, (_, f) =>
      Float64Array.from({ length: nFrames }, (_, t) => Math.atan2(spec.im[f][t], spec.re[f][t])),
    );
    if (scheme === "ifreq") angle = phaseToIfreq(angle, nFft, hop, anchor);

    for (let f = 0; f < nBins; f++) {
      for (let t = 0; t < nFrames; t++) {
        const hue = (((angle[f][t] / (2 * Math.PI)) % 1) + 1) % 1;
        const [r, g, b] = hsvToRgb(hue, 1, value[f][t]);
        const row = height - 1 - f;
        const idx = (row * width + t) * 4;
        data[idx] = Math.round(r * 255);
        data[idx + 1] = Math.round(g * 255);
        data[idx + 2] = Math.round(b * 255);
        data[idx + 3] = 255;
      }
    }
  }

  return {
    width,
    height,
    data,
    meta: { scheme, sr, nFft, hop, ref, anchor, nSamples: x.length },
  };
}

export function decode(width: number, height: number, data: Uint8ClampedArray, meta: Meta): Float64Array {
  const { scheme, nFft, hop, ref, anchor, nSamples } = meta;
  const nBins = height, nFrames = width;

  const value: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  const hueOrGray: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));

  for (let f = 0; f < nBins; f++) {
    const row = height - 1 - f;
    for (let t = 0; t < nFrames; t++) {
      const idx = (row * width + t) * 4;
      const r = data[idx] / 255, g = data[idx + 1] / 255, b = data[idx + 2] / 255;
      const [h, , v] = rgbToHsv(r, g, b);
      hueOrGray[f][t] = h;
      value[f][t] = v;
    }
  }

  const magnitude: Float64Array[] = Array.from({ length: nBins }, (_, f) =>
    Float64Array.from({ length: nFrames }, (_, t) => valueToMagnitude(value[f][t], ref)),
  );

  if (scheme === "gray") {
    return griffinLim(magnitude, nFft, hop, 32, nSamples);
  }

  let angle: Float64Array[] = Array.from({ length: nBins }, (_, f) =>
    Float64Array.from({ length: nFrames }, (_, t) => hueOrGray[f][t] * 2 * Math.PI),
  );
  if (scheme === "ifreq") {
    const wrapped = angle.map((row) => Float64Array.from(row, wrap));
    angle = ifreqToPhase(wrapped, nFft, hop, anchor);
  }

  const re: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  const im: Float64Array[] = Array.from({ length: nBins }, () => new Float64Array(nFrames));
  for (let f = 0; f < nBins; f++) {
    for (let t = 0; t < nFrames; t++) {
      re[f][t] = magnitude[f][t] * Math.cos(angle[f][t]);
      im[f][t] = magnitude[f][t] * Math.sin(angle[f][t]);
    }
  }

  return istft({ re, im, nFft, hop }, nSamples);
}
