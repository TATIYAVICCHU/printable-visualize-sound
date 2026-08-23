/**
 * A stand-in for printing an image and photographing it again.
 * Port of vsound/channel.py, operating directly on canvas ImageData.
 */

export interface Damage {
  blur: number; // gaussian sigma in px
  chroma: number; // chroma subsample factor, 1 = none
  gamma: number; // printed tone curve
  noise: number; // sensor noise, 0..1 scale
}

export const DAMAGE_PRESETS: Record<string, Damage> = {
  clean: { blur: 0, chroma: 1, gamma: 1, noise: 0 },
  light: { blur: 0.5, chroma: 2, gamma: 1.15, noise: 0.005 },
  moderate: { blur: 0.8, chroma: 2, gamma: 1.15, noise: 0.01 },
  harsh: { blur: 1.4, chroma: 3, gamma: 1.15, noise: 0.02 },
};

function boxBlur(channel: Float32Array<ArrayBuffer>, w: number, h: number, radius: number): Float32Array<ArrayBuffer> {
  if (radius <= 0) return channel;
  const tmp = new Float32Array(channel.length);
  const r = Math.max(1, Math.round(radius));
  // horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) { sum += channel[y * w + xx]; count++; }
      }
      tmp[y * w + x] = sum / count;
    }
  }
  const out = new Float32Array(channel.length);
  // vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, count = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) { sum += tmp[yy * w + x]; count++; }
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

function rgbToYcc(r: number, g: number, b: number): [number, number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 0.5;
  const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 0.5;
  return [y, cb, cr];
}

function yccToRgb(y: number, cb: number, cr: number): [number, number, number] {
  const cbs = cb - 0.5, crs = cr - 0.5;
  const r = y + 1.402 * crs;
  const g = y - 0.344136 * cbs - 0.714136 * crs;
  const b = y + 1.772 * cbs;
  return [r, g, b];
}

let rngState = 42;
function rand(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}
function gaussianNoise(): number {
  const u1 = Math.max(rand(), 1e-9), u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function printScan(width: number, height: number, src: Uint8ClampedArray, damage: Damage): Uint8ClampedArray {
  const n = width * height;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = src[i * 4] / 255;
    g[i] = src[i * 4 + 1] / 255;
    b[i] = src[i * 4 + 2] / 255;
  }

  let rr = r, gg = g, bb = b;
  if (damage.blur > 0) {
    rr = boxBlur(r, width, height, damage.blur);
    gg = boxBlur(g, width, height, damage.blur);
    bb = boxBlur(b, width, height, damage.blur);
  }

  if (damage.chroma > 1) {
    const y = new Float32Array(n), cb = new Float32Array(n), cr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [yy, cbv, crv] = rgbToYcc(rr[i], gg[i], bb[i]);
      y[i] = yy; cb[i] = cbv; cr[i] = crv;
    }
    const cbBlur = boxBlur(cb, width, height, damage.chroma);
    const crBlur = boxBlur(cr, width, height, damage.chroma);
    for (let i = 0; i < n; i++) {
      const [nr, ng, nb] = yccToRgb(y[i], cbBlur[i], crBlur[i]);
      rr[i] = nr; gg[i] = ng; bb[i] = nb;
    }
  }

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    let rv = rr[i], gv = gg[i], bv = bb[i];
    if (damage.gamma !== 1) {
      rv = Math.pow(Math.max(rv, 0), damage.gamma);
      gv = Math.pow(Math.max(gv, 0), damage.gamma);
      bv = Math.pow(Math.max(bv, 0), damage.gamma);
    }
    if (damage.noise > 0) {
      rv += gaussianNoise() * damage.noise;
      gv += gaussianNoise() * damage.noise;
      bv += gaussianNoise() * damage.noise;
    }
    out[i * 4] = Math.round(Math.min(Math.max(rv, 0), 1) * 255);
    out[i * 4 + 1] = Math.round(Math.min(Math.max(gv, 0), 1) * 255);
    out[i * 4 + 2] = Math.round(Math.min(Math.max(bv, 0), 1) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function undoGamma(width: number, height: number, src: Uint8ClampedArray, gamma: number): Uint8ClampedArray {
  if (gamma === 1) return src;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const v = src[i * 4 + c] / 255;
      out[i * 4 + c] = Math.round(Math.pow(Math.max(v, 0), 1 / gamma) * 255);
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Nearest-neighbour expand of each pixel into a b x b block. */
export function expandBlocks(width: number, height: number, src: Uint8ClampedArray, b: number): {
  width: number; height: number; data: Uint8ClampedArray;
} {
  if (b <= 1) return { width, height, data: src };
  const w2 = width * b, h2 = height * b;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    const sy = Math.floor(y / b);
    for (let x = 0; x < w2; x++) {
      const sx = Math.floor(x / b);
      const si = (sy * width + sx) * 4;
      const di = (y * w2 + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
    }
  }
  return { width: w2, height: h2, data: out };
}

/** Average each b x b block (trimming edges for large blocks) back to one pixel. */
export function shrinkBlocks(width: number, height: number, src: Uint8ClampedArray, b: number): {
  width: number; height: number; data: Uint8ClampedArray;
} {
  if (b <= 1) return { width, height, data: src };
  const w2 = Math.floor(width / b), h2 = Math.floor(height / b);
  const trim = b >= 4 ? Math.floor(b / 4) : 0;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let dy = trim; dy < b - trim; dy++) {
        for (let dx = trim; dx < b - trim; dx++) {
          const si = ((y * b + dy) * width + (x * b + dx)) * 4;
          sr += src[si]; sg += src[si + 1]; sb += src[si + 2];
          count++;
        }
      }
      const di = (y * w2 + x) * 4;
      out[di] = Math.round(sr / count);
      out[di + 1] = Math.round(sg / count);
      out[di + 2] = Math.round(sb / count);
      out[di + 3] = 255;
    }
  }
  return { width: w2, height: h2, data: out };
}
