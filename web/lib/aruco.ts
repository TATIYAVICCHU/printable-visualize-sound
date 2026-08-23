/**
 * Fiducial markers for locating a printed page in an arbitrary photo.
 *
 * A camera shot of a printed page is never framed square-on: rotation, skew,
 * and scale are all unknown ahead of time. Solving that by assuming perfect
 * framing (a fixed center-crop) silently produces garbage the moment the
 * page is tilted or the shot is imperfect -- exactly the failure this
 * module exists to avoid.
 *
 * ArUco markers are the established fix, used the same way across
 * robotics/AR: print a handful of small, uniquely-identifiable patterns at
 * known positions, detect them wherever they land in the photo, and solve
 * for the transform between "where things are on the page" and "where they
 * ended up in the photo." The vsound Python pipeline (scripts/make_print_target.py,
 * scripts/decode_scan.py) does exactly this with OpenCV's ArUco
 * implementation; this module does the same thing client-side with
 * js-aruco2's ARUCO_DEFAULT_OPENCV dictionary, which is a direct, bit-for-bit
 * port of the OpenCV dictionary the Python side uses -- verified by
 * generating a marker in Python and detecting it here, hamming distance 0.
 */

import pkg from "js-aruco2";
// Registers the OpenCV-compatible dictionary as a side effect.
import "js-aruco2/src/dictionaries/aruco_default_opencv.js";

const { AR } = pkg as unknown as {
  AR: {
    DICTIONARIES: Record<string, { nBits: number; codeList: string[] }>;
    Dictionary: new (name: string) => { codeList: string[]; markSize: number };
    Detector: new (config: { dictionaryName: string }) => {
      detectImage: (w: number, h: number, data: Uint8ClampedArray) => Marker[];
    };
  };
};

const DICT_NAME = "ARUCO_DEFAULT_OPENCV";

export interface Marker {
  id: number;
  corners: { x: number; y: number }[];
  hammingDistance: number;
}

export interface Point {
  x: number;
  y: number;
}

let dictionaryCache: { codeList: string[]; markSize: number } | null = null;
function getDictionary() {
  if (!dictionaryCache) dictionaryCache = new AR.Dictionary(DICT_NAME);
  return dictionaryCache;
}

/** Draw one marker's bit pattern into a canvas, filling a size x size square. */
export function drawMarker(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, size: number) {
  const dict = getDictionary();
  const code = dict.codeList[id];
  if (!code) throw new Error(`marker id ${id} not valid for ${DICT_NAME}`);
  const dataSize = dict.markSize - 2; // e.g. 5 for a 5x5-bit dictionary
  const totalCells = dataSize + 2; // + 1-cell black border on each side
  const cell = size / totalCells;

  ctx.fillStyle = "black";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "white";
  for (let row = 0; row < dataSize; row++) {
    for (let col = 0; col < dataSize; col++) {
      if (code[row * dataSize + col] === "1") {
        ctx.fillRect(x + (col + 1) * cell, y + (row + 1) * cell, cell + 0.5, cell + 0.5);
      }
    }
  }
}

/** Detect all markers in a frame; returns each marker's id and center point. */
export function detectMarkers(width: number, height: number, data: Uint8ClampedArray): { id: number; center: Point }[] {
  const detector = new AR.Detector({ dictionaryName: DICT_NAME });
  const markers = detector.detectImage(width, height, data);
  return markers.map((m) => ({
    id: m.id,
    center: {
      x: m.corners.reduce((s, c) => s + c.x, 0) / m.corners.length,
      y: m.corners.reduce((s, c) => s + c.y, 0) / m.corners.length,
    },
  }));
}

/** Standard 4-point homography (DLT) mapping src points onto dst points. */
export function computeHomography(src: Point[], dst: Point[]): number[] {
  if (src.length !== 4 || dst.length !== 4) throw new Error("need exactly 4 point correspondences");

  // Build the 8x8 linear system A h = b for the unknowns h0..h7 (h8 fixed to 1).
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  const h = solveLinearSystem(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting for a square system. */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) throw new Error("singular homography system");

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyHomography(H: number[], p: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = H;
  const w = g * p.x + h * p.y + i;
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  codeX0: number;
  codeY0: number;
  markerSize: number;
  markerPositions: Record<number, Point>; // top-left corner of each marker, ids 0=TL,1=TR,2=BR,3=BL
  markerCenters: Record<number, Point>;
}

/** Lay out a code area of the given size on a page with four corner markers,
 * clockwise from top-left (0,1,2,3) -- mirrors scripts/make_print_target.py
 * so the same detection and sampling logic applies to both. */
export function layoutPage(codeWidth: number, codeHeight: number): PageLayout {
  const markerSize = Math.max(60, Math.round(Math.min(codeWidth, codeHeight) * 0.12));
  const markerMargin = Math.round(markerSize * 0.3);
  const pageMargin = Math.round(markerSize * 0.3);

  const codeX0 = pageMargin + markerSize + markerMargin;
  const codeY0 = pageMargin + markerSize + markerMargin;
  const pageWidth = codeX0 + codeWidth + markerMargin + markerSize + pageMargin;
  const pageHeight = codeY0 + codeHeight + markerMargin + markerSize + pageMargin;

  const markerPositions: Record<number, Point> = {
    0: { x: pageMargin, y: pageMargin },
    1: { x: pageWidth - pageMargin - markerSize, y: pageMargin },
    2: { x: pageWidth - pageMargin - markerSize, y: pageHeight - pageMargin - markerSize },
    3: { x: pageMargin, y: pageHeight - pageMargin - markerSize },
  };
  const markerCenters: Record<number, Point> = {};
  for (const [id, p] of Object.entries(markerPositions)) {
    markerCenters[Number(id)] = { x: p.x + markerSize / 2, y: p.y + markerSize / 2 };
  }

  return { pageWidth, pageHeight, codeX0, codeY0, markerSize, markerPositions, markerCenters };
}

/** Sample one color per bin straight out of a captured/photographed frame,
 * via the inverse homography -- one bilinear-ish sample per block, at the
 * coordinate the block actually occupies on the page, however the page was
 * rotated, skewed, or scaled in the shot. Mirrors
 * scripts/decode_scan.py's sample_blocks_via_homography: warping the whole
 * frame first and then averaging an integer block grid over it compounds
 * enough rounding error to corrupt hue-encoded phase even on a
 * distortion-free re-photograph, so that two-step approach is avoided here
 * too. */
export function sampleBlocksViaHomography(
  frameWidth: number, frameHeight: number, frameData: Uint8ClampedArray,
  H_photo_to_page: number[], codeX0: number, codeY0: number,
  codeWidth: number, codeHeight: number, block: number,
): Uint8ClampedArray {
  const H_page_to_photo = invertHomography(H_photo_to_page);
  const binsW = Math.floor(codeWidth / block);
  const binsH = Math.floor(codeHeight / block);
  const out = new Uint8ClampedArray(binsW * binsH * 4);

  for (let by = 0; by < binsH; by++) {
    for (let bx = 0; bx < binsW; bx++) {
      const pageX = codeX0 + (bx + 0.5) * block;
      const pageY = codeY0 + (by + 0.5) * block;
      const { x: fx, y: fy } = applyHomography(H_page_to_photo, { x: pageX, y: pageY });

      const x0 = Math.max(0, Math.min(frameWidth - 1, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(frameHeight - 1, Math.floor(fy)));
      const x1 = Math.min(frameWidth - 1, x0 + 1);
      const y1 = Math.min(frameHeight - 1, y0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const ty = Math.min(1, Math.max(0, fy - y0));

      const idx = (y: number, x: number) => (y * frameWidth + x) * 4;
      const outIdx = (by * binsW + bx) * 4;
      for (let c = 0; c < 3; c++) {
        const v00 = frameData[idx(y0, x0) + c];
        const v10 = frameData[idx(y0, x1) + c];
        const v01 = frameData[idx(y1, x0) + c];
        const v11 = frameData[idx(y1, x1) + c];
        const v0 = v00 * (1 - tx) + v10 * tx;
        const v1 = v01 * (1 - tx) + v11 * tx;
        out[outIdx + c] = v0 * (1 - ty) + v1 * ty;
      }
      out[outIdx + 3] = 255;
    }
  }
  return out;
}

export function invertHomography(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error("singular homography");
  const inv = [
    (e * i - f * h), (c * h - b * i), (b * f - c * e),
    (f * g - d * i), (a * i - c * g), (c * d - a * f),
    (d * h - e * g), (b * g - a * h), (a * e - b * d),
  ].map((v) => v / det);
  return inv;
}
