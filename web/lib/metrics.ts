/** Quality measures comparing recovered audio against the original. Port of vsound/metrics.py (PESQ/STOI omitted — no lightweight JS equivalent). */

export function snrDb(reference: Float64Array, test: Float64Array): number {
  const n = Math.min(reference.length, test.length);
  let signal = 0, noise = 0;
  for (let i = 0; i < n; i++) {
    signal += reference[i] * reference[i];
    const d = reference[i] - test[i];
    noise += d * d;
  }
  if (noise < 1e-20) return Infinity;
  return 10 * Math.log10(signal / noise);
}

export function correlation(reference: Float64Array, test: Float64Array): number {
  const n = Math.min(reference.length, test.length);
  let dot = 0, refSq = 0, testSq = 0;
  for (let i = 0; i < n; i++) {
    dot += reference[i] * test[i];
    refSq += reference[i] * reference[i];
    testSq += test[i] * test[i];
  }
  const denom = Math.sqrt(refSq * testSq);
  return denom < 1e-20 ? 0 : dot / denom;
}
